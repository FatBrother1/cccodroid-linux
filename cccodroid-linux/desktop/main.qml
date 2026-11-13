// cccodroid Linux 原生窗口（Qt6 WebEngine）
// 用法：qml main.qml -- [--kiosk] [--selftest --out=PNG] [--token-file=路径] [--key-file=路径] [--url=地址]
//      [--download-dir=目录] [--data-dir=目录] [--base-url=http://127.0.0.2:8790]
// 一般由 bin/cccodroid-ui 启动（它负责单实例锁、桥口令文件和这些参数）。
// 仅供测试：--test-pick=路径 / --test-save=路径 让文件选择框 / 另存为直接用该路径作答；
//          --test-hooks 让页面多出 window.__ccTest（状态快照和几个控制命令）。
import QtCore
import QtQuick
import QtQuick.Window
import QtQuick.Dialogs
import QtWebEngine
import QtWebChannel

Window {
    id: win
    width: 1280
    height: 800
    minimumWidth: 640
    minimumHeight: 400
    color: "#1f1e1d"
    title: selfTest ? ("cccodroid [" + status + "]") : "cccodroid"

    readonly property string homeDir: String(StandardPaths.writableLocation(StandardPaths.HomeLocation)).replace(/^file:\/\//, "")
    readonly property bool kioskMode: argValue("--kiosk", false) === true
    readonly property bool selfTest: argValue("--selftest", false) === true
    readonly property bool testHooks: argValue("--test-hooks", false) === true
    readonly property string outPath: argValue("--out", "/tmp/cccodroid-selftest.png")
    readonly property string tokenPath: argValue("--token-file", homeDir + "/.local/share/cccodroid/home/.gateway-token")
    readonly property string keyPath: argValue("--key-file", "")
    readonly property string downloadDir: argValue("--download-dir", homeDir + "/Downloads")
    readonly property string dataDir: argValue("--data-dir", homeDir + "/.local/share/cccodroid/home/.qtwebengine")
    readonly property string baseUrl: argValue("--base-url", "http://127.0.0.2:8790")
    property string pageUrl: ""
    property string status: "init"
    property string bridgeKey: ""
    property int crashCount: 0
    property double crashWindowStart: 0
    property var pendingPick: null
    property real zoom: 1.0
    property bool geomReady: false
    property bool started: false

    // 内嵌浏览器窗格：paneRect 是页面里占位框的位置（CSS px），paneShown 由 paneOpen / paneClose 控制，
    // fullBrowser 是窄屏时 openBrowser 要的整窗模式。
    property rect paneRect: Qt.rect(0, 0, 0, 0)
    property bool paneShown: false
    property bool fullBrowser: false

    property string panePending: ""
    property var saveJob: null
    property string saveUrl: ""
    property int saveSeq: 0

    property double badKeyAt: 0
    property int badKeyCount: 0
    property var consoleSeen: ({})
    property int consoleSeenCount: 0
    property double consoleWindowStart: 0
    property int consoleWindowCount: 0

    function argValue(name, dflt) {
        var args = Qt.application.arguments
        for (var i = 0; i < args.length; i++) {
            if (args[i] === name)
                return true
            if (args[i].indexOf(name + "=") === 0)
                return args[i].substring(name.length + 1)
        }
        return dflt
    }

    function readToken(path) {
        var xhr = new XMLHttpRequest()
        try {
            xhr.open("GET", "file://" + path, false)
            xhr.send()
            if (xhr.status === 200 || xhr.status === 0) {
                var t = xhr.responseText.trim()
                if (t.length > 0)
                    return t
            }
        } catch (e) {
        }
        return ""
    }

    function randomHex(n) {
        var s = ""
        for (var i = 0; i < n; i++)
            s += "0123456789abcdef".charAt(Math.floor(Math.random() * 16))
        return s
    }

    function fileUrlToPath(u) {
        var s = String(u)
        if (s.indexOf("file://") === 0)
            s = s.substring(7)
        try { return decodeURIComponent(s) } catch (e) { return s }
    }

    function originOf(u) {
        var m = /^(https?:\/\/[^\/?#]+)/i.exec(String(u))
        return m ? m[1].toLowerCase() : ""
    }

    // 外部链接只放行 http / https / mailto；file://、steam:// 之类的协议不交给系统去打开。
    function openExternal(u) {
        var s = String(u)
        if (/^(https?|mailto):/i.test(s)) {
            console.log("open external: " + s.split(/[?#]/)[0].substring(0, 100))
            Qt.openUrlExternally(s)
        } else {
            console.log("blocked external url: " + s.split(/[?#]/)[0].substring(0, 100))
        }
    }

    // 下载结果通知页面：界面里的 window.__ccSaved 就是安卓「保存到」的结果回调，会弹「已保存 / 保存失败」。
    function notifySaved(ok, msg) {
        view.runJavaScript("window.__ccSaved && window.__ccSaved(" + (ok ? "true" : "false") + "," + JSON.stringify(String(msg)) + ")")
    }

    // 文件选择框的结果统一从这里回给网页：files 为空数组或 null 表示取消。
    function finishPick(files) {
        var r = win.pendingPick
        win.pendingPick = null
        if (!r)
            return
        try {
            if (files && files.length > 0)
                r.dialogAccept(files)
            else
                r.dialogReject()
        } catch (e) {
            console.log("file dialog: " + e)
        }
    }

    // ── 原生桥口令 ─────────────────────────────────────────────────
    // 口令 32 位 hex，经首页地址的 #k= 交给主框架；有副作用的桥方法第一个参数必须是它。
    function keyOk(k, name) {
        if (win.bridgeKey !== "" && typeof k === "string" && k === win.bridgeKey)
            return true
        var now = Date.now()
        if (now - win.badKeyAt > 60000) {
            win.badKeyAt = now
            win.badKeyCount = 0
        }
        if (win.badKeyCount < 5) {
            win.badKeyCount++
            console.log("bridge: rejected " + name + " (bad key)")
        }
        return false
    }

    // Qt 6.11 起 NavigationRequest.action 已弃用，改用 reject()；老版本回退到 action
    function rejectNav(request) {
        if (typeof request.reject === "function")
            request.reject()
        else
            request.action = WebEngineNavigationRequest.IgnoreRequest
    }

    function num(v) {
        var n = Number(v)
        return isFinite(n) ? n : 0
    }

    function cleanRect(x, y, w, h) {
        return Qt.rect(Math.max(-1000, Math.min(num(x), 20000)), Math.max(-1000, Math.min(num(y), 20000)),
                       Math.max(0, Math.min(num(w), 20000)), Math.max(0, Math.min(num(h), 20000)))
    }

    // ── 内嵌浏览器窗格 ─────────────────────────────────────────────
    // 地址栏 / paneOpen 传进来的文字规整成能打开的网址；返回空串表示不放行。
    // 没写协议时：localhost、127.x、带端口的按 http，其余按 https。
    function webUrl(text) {
        var s = String(text).trim()
        if (s.length === 0)
            return ""
        if (/^(javascript|data|file|about|blob|view-source|mailto|tel|steam|ftp):/i.test(s) || /^[a-z][a-z0-9+.\-]*:\/\//i.test(s)) {
            if (/^https?:\/\//i.test(s) || s === "about:blank")
                return s
            console.log("pane: blocked url " + s.split(/[?#]/)[0].substring(0, 100))
            return ""
        }
        if (/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(s) || /^[^\/?#\s]+:\d+(\/|\?|#|$)/.test(s))
            return "http://" + s
        return "https://" + s
    }

    function paneNavigate(text) {
        var t = webUrl(text)
        if (t.length === 0)
            return
        if (pane.pv)
            pane.pv.url = t
        else
            win.panePending = t
    }

    function paneOpenUrl(u, full) {
        win.fullBrowser = full
        win.paneShown = true
        if (String(u).length > 0)
            paneNavigate(u)
    }

    // 窗格的网页视图只在显示时才存在（Loader），关掉就销毁：历史、播放、网络一并释放，下次打开从头开始。
    function paneHide(fromUser) {
        var wasFull = win.fullBrowser
        win.paneShown = false
        win.fullBrowser = false
        win.panePending = ""
        addrInput.text = ""
        if (fromUser && !wasFull)
            view.runJavaScript("window.__ccBrowserClosed && window.__ccBrowserClosed()")
    }

    // ── 保存到（CCApp.saveAs）─────────────────────────────────────
    // 选好位置后让辅助视图（和主视图同一个 profile，带着网关登录 cookie）去取 /api/file?download=1，
    // 下载请求里按选好的位置落盘；结果经 window.__ccSaved 回给页面。
    function saveAsStart(path, name, mime) {
        if (path.length === 0 || path.length > 4096) {
            notifySaved(false, "missing")
            return
        }
        if (win.saveJob) {
            notifySaved(false, "busy")
            return
        }
        var nm = (name.length > 0 ? name : path.split("/").pop()).replace(/[\/\\]/g, "_")
        if (nm.length === 0)
            nm = "download"
        win.saveJob = { path: path, name: nm, dir: "", started: false }
        var testSave = String(argValue("--test-save", ""))
        if (testSave.length > 0 && testSave !== "false") {
            saveBegin(testSave)
            return
        }
        saveDialog.selectedFile = "file://" + encodeURI(win.downloadDir + "/" + nm)
        saveDialog.open()
    }

    function saveBegin(target) {
        var job = win.saveJob
        if (!job)
            return
        var i = target.lastIndexOf("/")
        job.dir = i > 0 ? target.substring(0, i) : "/"
        job.name = target.substring(i + 1)
        win.saveSeq++
        saveTimer.restart()
        win.saveUrl = win.baseUrl + "/api/file?path=" + encodeURIComponent(job.path) + "&download=1&_s=" + win.saveSeq
    }

    function saveEnd(ok, msg) {
        saveTimer.stop()
        win.saveJob = null
        win.saveUrl = ""
        notifySaved(ok, msg)
    }

    // 下载：主窗口、窗格、另存为辅助视图共用。存到下载目录（另存为则存到选好的位置），完成或失败后在界面里弹提示。
    function handleDownload(download) {
        try {
            var job = (win.saveJob && saveLoader.item && download.view === saveLoader.item) ? win.saveJob : null
            if (job) {
                job.started = true
                saveTimer.stop()
                download.downloadDirectory = job.dir
                download.downloadFileName = job.name
            } else {
                download.downloadDirectory = win.downloadDir
            }
            download.stateChanged.connect(function() {
                var where = download.downloadDirectory.split("/").pop() + "/" + download.downloadFileName
                if (download.state === WebEngineDownloadRequest.DownloadCompleted) {
                    if (job)
                        win.saveEnd(true, where)
                    else
                        win.notifySaved(true, where)
                } else if (download.state === WebEngineDownloadRequest.DownloadInterrupted || download.state === WebEngineDownloadRequest.DownloadCancelled) {
                    var why = download.interruptReasonString || "下载中断"
                    if (job)
                        win.saveEnd(false, why)
                    else
                        win.notifySaved(false, why)
                }
            })
            download.accept()
        } catch (e) {
            console.log("download failed: " + e)
            if (win.saveJob)
                win.saveEnd(false, String(e))
        }
    }

    // ── 缩放 / 全屏 / 刷新 / 窗口位置 ──────────────────────────────
    function setZoom(z) {
        var v = Math.max(0.5, Math.min(3.0, Math.round(z * 10) / 10))
        win.zoom = v
        prefs.zoom = v
        hudShow("缩放 " + Math.round(v * 100) + "%")
    }

    function zoomBy(d) {
        setZoom(win.zoom + d)
    }

    function hudShow(text) {
        hudText.text = text
        hud.opacity = 1
        hudTimer.restart()
    }

    function toggleFullscreen() {
        if (kioskMode)
            return
        if (visibility === Window.FullScreen)
            visibility = prefs.winMax ? Window.Maximized : Window.Windowed
        else
            visibility = Window.FullScreen
    }

    function reloadFocused(bypass) {
        var v = (pane.visible && pane.pv && pane.pv.activeFocus) ? pane.pv : view
        if (bypass)
            v.reloadAndBypassCache()
        else
            v.reload()
    }

    function saveGeometry() {
        if (!geomReady || kioskMode || selfTest)
            return
        if (visibility === Window.Windowed) {
            prefs.winW = width
            prefs.winH = height
            if (Qt.platform.pluginName !== "wayland") {
                prefs.winX = x
                prefs.winY = y
            }
            prefs.winMax = false
        } else if (visibility === Window.Maximized) {
            prefs.winMax = true
        }
    }

    function restoreGeometry() {
        var sw = Screen.desktopAvailableWidth
        var sh = Screen.desktopAvailableHeight
        if (sw > 0 && sh > 0) {
            width = Math.max(minimumWidth, Math.min(prefs.winW, sw))
            height = Math.max(minimumHeight, Math.min(prefs.winH, sh))
            if (Qt.platform.pluginName !== "wayland" && prefs.winX >= 0 && prefs.winY >= 0
                    && prefs.winX + 120 <= sw && prefs.winY + 80 <= sh) {
                x = prefs.winX
                y = prefs.winY
            }
        }
        if (prefs.winMax)
            visibility = Window.Maximized
    }

    // ── 控制台消息：只记 warning 及以上，同一条十分钟内只记一次，每分钟最多 20 条 ──
    function consoleLog(level, message, line, source) {
        if (level < WebEngineView.WarningMessageLevel)
            return
        var m = String(message)
        if (m.indexOf("Refused to execute inline script") === 0)
            return
        var now = Date.now()
        if (now - win.consoleWindowStart > 60000) {
            win.consoleWindowStart = now
            win.consoleWindowCount = 0
        }
        if (win.consoleWindowCount >= 20)
            return
        var key = level + "|" + m.substring(0, 300) + "|" + source + ":" + line
        var seen = win.consoleSeen[key]
        if (seen && now - seen < 600000)
            return
        if (win.consoleSeenCount > 200) {
            win.consoleSeen = ({})
            win.consoleSeenCount = 0
        }
        win.consoleSeen[key] = now
        win.consoleSeenCount++
        win.consoleWindowCount++
        var src = String(source).split("/").pop()
        console.log("console." + (level >= WebEngineView.ErrorMessageLevel ? "error" : "warn") + ": " + m.substring(0, 300) + " (" + src + ":" + line + ")")
    }

    function capture() {
        status = "grabbing"
        win.contentItem.grabToImage(function(result) {
            var ok = result.saveToFile(outPath)
            if (ok) {
                status = "saved"
                finishTimer.start()
            } else {
                status = "grab-save-failed"
                pdfFallback()
            }
        }, Qt.size(win.width, win.height))
    }

    function pdfFallback() {
        status = "pdf"
        view.printToPdf(outPath.replace(/\.png$/, ".pdf"))
    }

    // 仅 --test-hooks：状态快照和控制命令
    function snapshot() {
        return JSON.stringify({
            zoom: view.zoomFactor,
            win: { w: width, h: height, x: x, y: y, vis: visibility },
            pane: { shown: paneShown, visible: pane.visible, full: fullBrowser, rect: [paneRect.x, paneRect.y, paneRect.width, paneRect.height],
                    item: [pane.x, pane.y, pane.width, pane.height], url: pane.pv ? String(pane.pv.url) : "about:blank", canBack: pane.canBack },
            save: saveJob !== null,
            kiosk: kioskMode
        })
    }

    function testCmd(name, arg) {
        if (name === "resize") {
            var p = String(arg).split("x")
            width = Number(p[0])
            height = Number(p[1])
        } else if (name === "zoom") {
            setZoom(Number(arg))
        } else if (name === "zoomin") {
            zoomBy(0.1)
        } else if (name === "zoomout") {
            zoomBy(-0.1)
        } else if (name === "zoomreset") {
            setZoom(1.0)
        } else if (name === "f11") {
            toggleFullscreen()
        } else if (name === "reload") {
            reloadFocused(false)
        } else if (name === "paneclose") {
            paneHide(true)
        } else if (name === "shot") {
            win.contentItem.grabToImage(function(result) { result.saveToFile(String(arg)) })
        } else if (name === "paneext") {
            if (pane.pv)
                openExternal(pane.pv.url)
        } else if (name === "quit") {
            saveGeometry()
            Qt.quit()
        }
    }

    Component.onCompleted: {
        var kb = keyPath.length > 0 ? readToken(keyPath) : ""
        bridgeKey = /^[0-9a-f]{32}$/.test(kb) ? kb : randomHex(32)

        var u = argValue("--url", "")
        if (u.length === 0) {
            var t = argValue("--token", "")
            if (t === "") t = readToken(tokenPath)
            if (t.length > 0)
                u = baseUrl + "/?t=" + t
        }
        if (u.length > 0 && u.indexOf("#") < 0)
            u = u + "#k=" + bridgeKey
        pageUrl = u

        zoom = Math.max(0.5, Math.min(3.0, prefs.zoom))
        if (kioskMode) {
            flags = Qt.Window | Qt.FramelessWindowHint
            visibility = Window.FullScreen
        } else {
            if (!selfTest)
                restoreGeometry()
            if (!visible)
                visible = true
        }
        started = true
        geomTimer.start()

        if (selfTest) {
            hardTimer.start()
            if (u.length === 0) {
                status = "no-token"
                Qt.exit(5)
            }
        } else {
            status = "running"
        }
    }

    onClosing: {
        saveGeometry()
        Qt.quit()
    }
    onWidthChanged: if (started) geomTimer.restart()
    onHeightChanged: if (started) geomTimer.restart()
    onXChanged: if (started) geomTimer.restart()
    onYChanged: if (started) geomTimer.restart()
    onVisibilityChanged: if (started) geomTimer.restart()

    // 窗口大小、位置、最大化和缩放记在数据目录里，不写进用户其他的配置目录。
    Settings {
        id: prefs
        location: "file://" + encodeURI(win.dataDir) + "/shell.ini"
        property real zoom: 1.0
        property int winW: 1280
        property int winH: 800
        property int winX: -1
        property int winY: -1
        property bool winMax: false
    }

    Shortcut {
        sequence: "Ctrl+Q"
        context: Qt.ApplicationShortcut
        onActivated: Qt.quit()
    }
    Shortcut {
        sequences: ["Ctrl+=", "Ctrl++"]
        context: Qt.ApplicationShortcut
        onActivated: win.zoomBy(0.1)
    }
    Shortcut {
        sequence: "Ctrl+-"
        context: Qt.ApplicationShortcut
        onActivated: win.zoomBy(-0.1)
    }
    Shortcut {
        sequence: "Ctrl+0"
        context: Qt.ApplicationShortcut
        onActivated: win.setZoom(1.0)
    }
    Shortcut {
        sequences: ["F5", "Ctrl+R"]
        context: Qt.ApplicationShortcut
        onActivated: win.reloadFocused(false)
    }
    Shortcut {
        sequences: ["Ctrl+Shift+R", "Ctrl+F5"]
        context: Qt.ApplicationShortcut
        onActivated: win.reloadFocused(true)
    }
    Shortcut {
        sequence: "F11"
        enabled: !win.kioskMode
        context: Qt.ApplicationShortcut
        onActivated: win.toggleFullscreen()
    }
    Shortcut {
        sequence: "Ctrl+L"
        enabled: pane.visible
        context: Qt.ApplicationShortcut
        onActivated: {
            addrInput.forceActiveFocus()
            addrInput.selectAll()
        }
    }

    // 持久 profile：localStorage、Cookie、权限都落在 dataDir（主题、导航固定项这类界面偏好才不会每次丢）。
    // Qt 6.9 起直接 new WebEngineProfile 会提示改用 WebEngineProfilePrototype，但后者目前不能赋给 view.profile；
    // 这里继续用 WebEngineProfile（6.11 仍可用），档案目录显式指到应用自己的数据目录；缓存也放进去，不和别的实例共用。
    WebEngineProfile {
        id: mainProfile
        storageName: "cccodroid"
        offTheRecord: false
        persistentStoragePath: win.dataDir
        cachePath: win.dataDir + "/cache"
        downloadPath: win.downloadDir
        onDownloadRequested: function(download) { win.handleDownload(download) }
    }

    // 窗格用另一份 profile：网站的登录状态不和网关界面的 cookie 混在一起。
    WebEngineProfile {
        id: paneProfile
        storageName: "cccodroid-pane"
        offTheRecord: false
        persistentStoragePath: win.dataDir + "/pane"
        cachePath: win.dataDir + "/pane-cache"
        downloadPath: win.downloadDir
        onDownloadRequested: function(download) { win.handleDownload(download) }
    }

    // CCApp 垫片：web 端按安卓壳的约定调 window.CCApp.*（desktop/bridge.js 负责在页面里搭这层）。
    QtObject {
        id: ccapp
        WebChannel.id: "ccapp"
        readonly property bool paneCanBack: pane.visible && pane.canBack

        function openUrl(k, u) {
            if (win.keyOk(k, "openUrl"))
                win.openExternal(u)
        }
        function paneOpen(k, u) {
            if (win.keyOk(k, "paneOpen"))
                win.paneOpenUrl(String(u === undefined || u === null ? "" : u), false)
        }
        function paneBounds(k, x, y, w, h) {
            if (win.keyOk(k, "paneBounds"))
                win.paneRect = win.cleanRect(x, y, w, h)
        }
        function paneGoBack(k) {
            if (win.keyOk(k, "paneGoBack") && pane.pv && pane.pv.canGoBack)
                pane.pv.goBack()
        }
        function paneClose(k) {
            if (win.keyOk(k, "paneClose"))
                win.paneHide(false)
        }
        function openBrowser(k, u) {
            if (win.keyOk(k, "openBrowser"))
                win.paneOpenUrl(String(u === undefined || u === null ? "" : u), true)
        }
        function saveAs(k, p, n, m) {
            if (win.keyOk(k, "saveAs"))
                win.saveAsStart(String(p === undefined || p === null ? "" : p), String(n === undefined || n === null ? "" : n), String(m === undefined || m === null ? "" : m))
        }
    }

    QtObject {
        id: cctest
        WebChannel.id: "cctest"
        property string state: ""
        function cmd(name, arg) {
            if (win.testHooks)
                win.testCmd(String(name), String(arg))
        }
    }

    Timer {
        interval: 250
        running: win.testHooks
        repeat: true
        onTriggered: cctest.state = win.snapshot()
    }

    WebChannel {
        id: channel
        registeredObjects: win.testHooks ? [ccapp, cctest] : [ccapp]
    }

    WebEngineView {
        id: view
        anchors.fill: parent
        profile: mainProfile
        url: win.pageUrl
        focus: true
        zoomFactor: win.zoom
        webChannel: channel

        userScripts.collection: [
            {
                name: "qwebchannel",
                sourceUrl: "qrc:///qtwebchannel/qwebchannel.js",
                injectionPoint: WebEngineScript.DocumentCreation,
                worldId: WebEngineScript.MainWorld
            },
            {
                name: "ccapp",
                sourceUrl: Qt.resolvedUrl("bridge.js"),
                injectionPoint: WebEngineScript.DocumentCreation,
                worldId: WebEngineScript.MainWorld
            },
            {
                name: "ccflags",
                sourceCode: "window.__ccKiosk = " + (win.kioskMode ? "true" : "false") + ";",
                injectionPoint: WebEngineScript.DocumentCreation,
                worldId: WebEngineScript.MainWorld
            },
            {
                name: "gamepad",
                sourceUrl: Qt.resolvedUrl("gamepad.js"),
                injectionPoint: WebEngineScript.DocumentReady,
                worldId: WebEngineScript.MainWorld
            }
        ]

        onLoadingChanged: function(loadRequest) {
            if (loadRequest.status === WebEngineView.LoadSucceededStatus) {
                win.status = "loaded"
                if (win.selfTest)
                    shotTimer.start()
            } else if (loadRequest.status === WebEngineView.LoadFailedStatus) {
                win.status = "load-failed"
                if (win.selfTest)
                    shareFailTimer.start()
            }
        }

        // 页面里 target=_blank 的外部链接：交给系统浏览器，不在应用里再开一个窗口（只放行 http / https / mailto）
        onNewWindowRequested: function(request) {
            win.openExternal(request.requestedUrl)
        }

        // 主框架只允许停在网关自己的界面上：没带 target 的外链会把整个窗口导航走（窗口里没有后退键），
        // 一律交给系统浏览器。
        onNavigationRequested: function(request) {
            if (!request.isMainFrame)
                return
            var u = String(request.url)
            var o = win.originOf(u)
            if (u === "about:blank" || (o !== "" && (o === win.originOf(win.baseUrl) || o === win.originOf(win.pageUrl))))
                return
            win.rejectNav(request)
            win.openExternal(u)
        }

        // 页面请求全屏（PDF、视频）：跟随
        onFullScreenRequested: function(request) {
            request.accept()
        }

        // 权限：只给本机回环界面放行剪贴板，其余（摄像头、麦克风、定位、通知…）一律拒绝。
        // 不处理时 navigator.clipboard.writeText() 会一直等权限（Promise 不 resolve），界面上的「复制」看起来没反应。
        // permissionType 9 = ClipboardReadWrite（webEnginePermission.PermissionType 的第 10 项，Qt 6.8 起）。
        onPermissionRequested: function(request) {
            try {
                var o = String(request.origin)
                var local = o.indexOf("http://127.0.0.2:") === 0 || o.indexOf("http://127.0.0.1:") === 0
                if (local && request.permissionType === 9) {
                    request.grant()
                } else {
                    console.log("deny permission type=" + request.permissionType + " origin=" + o)
                    request.deny()
                }
            } catch (e) {
                console.log("permission: " + e)
            }
        }

        // <input type="file">：用 Qt 的文件 / 文件夹选择框，选完把路径交回页面。
        // accepted = true 表示这个请求由我们处理；不设的话 Qt 会再弹一个默认的选择框。
        // mode：0 打开单个文件，1 打开多个，2 上传文件夹，3 保存。
        onFileDialogRequested: function(request) {
            request.accepted = true
            if (win.pendingPick)
                win.finishPick(null)        // 上一个请求还没答复：先取消，保证每个请求只答复一次
            win.pendingPick = request
            var testPick = String(win.argValue("--test-pick", ""))
            if (testPick.length > 0 && testPick !== "false") {
                win.finishPick([testPick])
                return
            }
            if (request.mode === 2) {
                folderPicker.open()
                return
            }
            filePicker.fileMode = request.mode === 3 ? FileDialog.SaveFile
                                : request.mode === 1 ? FileDialog.OpenFiles : FileDialog.OpenFile
            if (request.mode === 3 && request.defaultFileName && request.defaultFileName.length > 0)
                filePicker.selectedFile = "file://" + win.downloadDir + "/" + request.defaultFileName
            filePicker.open()
        }

        onPdfPrintingFinished: function(filePath, success) {
            win.status = success ? "pdf-saved" : "pdf-failed"
            Qt.exit(success ? 6 : 7)
        }

        onJavaScriptConsoleMessage: function(level, message, lineNumber, sourceID) {
            win.consoleLog(level, message, lineNumber, sourceID)
        }

        // 渲染进程崩溃或被系统杀掉（内存不足）后页面会一直白屏。会话状态都在网关和 localStorage 里，重载即可恢复。
        // 一分钟内连续崩溃超过 3 次就不再自动重载，避免死循环。
        onRenderProcessTerminated: function(terminationStatus, exitCode) {
            console.log("render process terminated: status=" + terminationStatus + " exit=" + exitCode)
            if (win.selfTest)
                return
            var now = Date.now()
            if (now - win.crashWindowStart > 60000) {
                win.crashWindowStart = now
                win.crashCount = 0
            }
            win.crashCount++
            if (win.crashCount <= 3)
                reloadTimer.start()
        }
    }

    // 另存为的辅助视图：只用来发一次下载请求，不显示；选好保存位置才创建，完事就销毁。
    Loader {
        id: saveLoader
        active: win.saveJob !== null && win.saveUrl !== ""
        sourceComponent: WebEngineView {
            profile: mainProfile
            width: 2
            height: 2
            opacity: 0
            enabled: false
            url: win.saveUrl

            onLoadingChanged: function(info) {
                var job = win.saveJob
                if (!job || job.started)
                    return
                if (info.status !== WebEngineView.LoadFailedStatus)
                    return
                console.log("save helper: load failed domain=" + info.errorDomain + " code=" + info.errorCode + " " + info.errorString)
                // 取下载时被网关拒绝（文件不在 / 不让导出）：页面是错误的 JSON，没有下载请求
                if (info.errorDomain === WebEngineLoadingInfo.HttpStatusCodeDomain || info.errorDomain === WebEngineLoadingInfo.HttpErrorDomain)
                    win.saveEnd(false, info.errorCode === 404 ? "missing" : info.errorCode === 403 ? "forbidden" : "HTTP " + info.errorCode)
            }
        }
    }

    // 浏览器窗格：盖在页面里 #browser-slot 的位置上（paneBounds 报来的框，要乘页面缩放）。
    Item {
        id: pane
        z: 20
        visible: win.paneShown && (win.fullBrowser || (win.paneRect.width > 1 && win.paneRect.height > 1))
        x: win.fullBrowser ? 0 : Math.round(win.paneRect.x * view.zoomFactor)
        y: win.fullBrowser ? 0 : Math.round(win.paneRect.y * view.zoomFactor)
        width: win.fullBrowser ? win.width : Math.round(win.paneRect.width * view.zoomFactor)
        height: win.fullBrowser ? win.height : Math.round(win.paneRect.height * view.zoomFactor)
        clip: true

        property var pv: paneLoader.item
        readonly property bool canBack: pv ? pv.canGoBack : false
        readonly property bool loading: pv ? pv.loading : false

        component BarBtn: Rectangle {
            id: btn
            property string label: ""
            property bool active: true
            signal clicked()
            width: 30
            height: 30
            radius: 5
            color: area.pressed && active ? "#3d3b38" : (area.containsMouse && active ? "#34322f" : "transparent")
            Text {
                anchors.centerIn: parent
                text: btn.label
                font.pixelSize: 17
                color: btn.active ? "#e8e6e3" : "#6b6862"
            }
            MouseArea {
                id: area
                anchors.fill: parent
                hoverEnabled: true
                enabled: btn.active
                onClicked: btn.clicked()
            }
        }

        Rectangle {
            anchors.fill: parent
            color: "#1f1e1d"
        }

        Rectangle {
            id: bar
            height: 38
            anchors { left: parent.left; right: parent.right; top: parent.top }
            color: "#2a2927"

            BarBtn {
                id: bBack
                x: 6
                anchors.verticalCenter: parent.verticalCenter
                label: "‹"
                active: pane.canBack
                onClicked: pane.pv.goBack()
            }
            BarBtn {
                id: bFwd
                anchors { left: bBack.right; verticalCenter: parent.verticalCenter }
                label: "›"
                active: pane.pv ? pane.pv.canGoForward : false
                onClicked: pane.pv.goForward()
            }
            BarBtn {
                id: bReload
                anchors { left: bFwd.right; verticalCenter: parent.verticalCenter }
                label: pane.loading ? "■" : "↻"
                onClicked: pane.loading ? pane.pv.stop() : pane.pv.reload()
            }
            BarBtn {
                id: bClose
                anchors { right: parent.right; rightMargin: 6; verticalCenter: parent.verticalCenter }
                label: "✕"
                onClicked: win.paneHide(true)
            }
            BarBtn {
                id: bExt
                anchors { right: bClose.left; verticalCenter: parent.verticalCenter }
                label: "↗"
                active: pane.pv ? (String(pane.pv.url) !== "about:blank" && String(pane.pv.url) !== "") : false
                onClicked: win.openExternal(pane.pv.url)
            }
            Rectangle {
                id: addrBox
                anchors { left: bReload.right; right: bExt.left; leftMargin: 6; rightMargin: 6; verticalCenter: parent.verticalCenter }
                height: 28
                radius: 5
                color: "#1f1e1d"
                border.width: 1
                border.color: addrInput.activeFocus ? "#7c6bf0" : "#43403c"
                TextInput {
                    id: addrInput
                    anchors { fill: parent; leftMargin: 8; rightMargin: 8 }
                    verticalAlignment: TextInput.AlignVCenter
                    clip: true
                    selectByMouse: true
                    color: "#e8e6e3"
                    selectionColor: "#5b4fc0"
                    font.pixelSize: 13
                    onAccepted: {
                        win.paneNavigate(text)
                        if (pane.pv)
                            pane.pv.forceActiveFocus()
                    }
                }
            }
            Rectangle {
                anchors.bottom: parent.bottom
                height: 2
                width: parent.width * (pane.pv ? pane.pv.loadProgress : 0) / 100
                visible: pane.loading
                color: "#7c6bf0"
            }
        }

        Loader {
            id: paneLoader
            active: win.paneShown
            anchors { left: parent.left; right: parent.right; top: bar.bottom; bottom: parent.bottom }
            sourceComponent: WebEngineView {
                profile: paneProfile
                Component.onCompleted: {
                    if (win.panePending.length > 0)
                        url = win.panePending
                }

                onUrlChanged: {
                    if (!addrInput.activeFocus)
                        addrInput.text = String(url) === "about:blank" ? "" : String(url)
                }

                onNavigationRequested: function(request) {
                    if (!request.isMainFrame)
                        return
                    var u = String(request.url)
                    if (/^https?:\/\//i.test(u) || u === "about:blank")
                        return
                    win.rejectNav(request)
                    console.log("pane: blocked navigation " + u.split(/[?#]/)[0].substring(0, 100))
                }

                onNewWindowRequested: function(request) {
                    win.paneNavigate(String(request.requestedUrl))
                }

                onPermissionRequested: function(request) {
                    console.log("pane: deny permission type=" + request.permissionType + " origin=" + String(request.origin))
                    request.deny()
                }

                onFileDialogRequested: function(request) {
                    request.accepted = true
                    request.dialogReject()
                    console.log("pane: file dialog refused")
                }

                onFullScreenRequested: function(request) {
                    request.reject()
                }
            }
        }
    }

    Rectangle {
        id: hud
        z: 100
        anchors.horizontalCenter: parent.horizontalCenter
        y: 18
        width: hudText.implicitWidth + 28
        height: 34
        radius: 8
        color: "#d9101010"
        opacity: 0
        visible: opacity > 0
        Behavior on opacity { NumberAnimation { duration: 150 } }
        Text {
            id: hudText
            anchors.centerIn: parent
            color: "#f1efe9"
            font.pixelSize: 15
        }
    }

    FileDialog {
        id: filePicker
        title: "选择文件"
        fileMode: FileDialog.OpenFiles
        onAccepted: {
            var files = []
            for (var i = 0; i < selectedFiles.length; i++)
                files.push(win.fileUrlToPath(selectedFiles[i]))
            win.finishPick(files)
        }
        onRejected: win.finishPick(null)
    }

    FolderDialog {
        id: folderPicker
        title: "选择文件夹"
        onAccepted: win.finishPick([win.fileUrlToPath(selectedFolder)])
        onRejected: win.finishPick(null)
    }

    FileDialog {
        id: saveDialog
        title: "保存到"
        fileMode: FileDialog.SaveFile
        currentFolder: "file://" + encodeURI(win.downloadDir)
        onAccepted: win.saveBegin(win.fileUrlToPath(selectedFile))
        onRejected: win.saveEnd(false, "cancel")
    }

    Timer { id: reloadTimer; interval: 1500; repeat: false; onTriggered: view.reload() }
    Timer { id: shotTimer; interval: 3000; repeat: false; onTriggered: win.capture() }
    Timer { id: shareFailTimer; interval: 1000; repeat: false; onTriggered: win.pdfFallback() }
    Timer { id: finishTimer; interval: 400; repeat: false; onTriggered: Qt.exit(0) }
    Timer { id: hudTimer; interval: 1100; repeat: false; onTriggered: hud.opacity = 0 }
    Timer { id: saveTimer; interval: 30000; repeat: false; onTriggered: win.saveEnd(false, "timeout") }
    Timer {
        id: geomTimer
        interval: 700
        repeat: false
        onTriggered: {
            win.geomReady = true
            win.saveGeometry()
        }
    }
    Timer {
        id: hardTimer
        interval: 25000
        repeat: false
        onTriggered: {
            win.status = "timeout"
            Qt.exit(4)
        }
    }
}
