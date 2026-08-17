//! 配对弹窗的多语言文案。
//!
//! 为什么文案在 Rust 侧而不是复用扩展的 `_locales`：**请求方不能提供确认框的文字**。
//! 配对确认的全部意义是「确认者不是请求者」——如果文案由扩展传过来，一个恶意扩展就能把
//! 「是否连接？」改写成「是否关闭此提示？」。所以只有**语言代号**来自请求方，
//! 文案本身必须是 app 自己带的常量。
//!
//! 产品名与扩展 `_locales/*/messages.json` 的 `extName` 保持一致，避免同一个东西在
//! 弹窗里和浏览器里叫两个名字。

/// 一个语言的全部弹窗文案。
///
/// 配对确认与卸载确认共用这个形状 —— 两者都是「大标题 + 说明 + 两个命令链接 + 页脚」。
pub(super) struct PairingDialogText {
    /// 窗口标题栏。
    pub(super) window_title: &'static str,
    /// 大号主指令，一句话说清在问什么。
    pub(super) main_instruction: &'static str,
    /// 正文：授权范围 + 核对方式。`{id}` 由调用方替换成扩展 ID。
    pub(super) content: &'static str,
    /// 确认按钮。用动宾短语而不是「是」——用户扫一眼按钮就知道会发生什么。
    pub(super) confirm_button: &'static str,
    /// 拒绝按钮，同时是默认按钮。
    pub(super) decline_button: &'static str,
    /// 页脚补充说明。
    pub(super) footer: &'static str,
}

/// 扩展支持的 10 个 locale，外加英文兜底。
///
/// 与 `extension/_locales/` 的目录一一对应。新增语言时两边都要加，
/// `scripts/testing/pairing-dialog-locales.mjs` 会钉住这个对应关系。
pub(super) const SUPPORTED_LOCALES: &[&str] = &[
    "en", "zh_CN", "zh_TW", "ja", "ko", "de", "fr", "es", "pt_BR", "ru",
];

/// 把请求方给的语言代号归一化成 `SUPPORTED_LOCALES` 里的一个。
///
/// 接受 `zh-CN` / `zh_CN` / `zh` 三种写法。**永不失败**：认不出来就回落英文。
/// 这个值是请求方提供的，最坏结果只是显示错语言——它不参与任何安全判定。
pub(super) fn normalize_locale(raw_locale: &str) -> &'static str {
    let normalized = raw_locale.trim().replace('-', "_");

    if normalized.is_empty() || normalized.len() > 32 {
        return "en";
    }

    // 先精确匹配（大小写不敏感：zh_cn 也认）。
    for locale in SUPPORTED_LOCALES {
        if locale.eq_ignore_ascii_case(&normalized) {
            return locale;
        }
    }

    // 再按主语言标签匹配：zh_HK → zh_TW，pt_PT → pt_BR，en_GB → en。
    let primary = normalized
        .split('_')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();

    match primary.as_str() {
        // zh 不带地区时按简体处理；zh_HK / zh_MO 用繁体。
        "zh" => match normalized.to_ascii_uppercase().as_str() {
            value if value.ends_with("_HK") || value.ends_with("_MO") || value.ends_with("_TW") => {
                "zh_TW"
            }
            _ => "zh_CN",
        },
        "pt" => "pt_BR",
        "ja" => "ja",
        "ko" => "ko",
        "de" => "de",
        "fr" => "fr",
        "es" => "es",
        "ru" => "ru",
        _ => "en",
    }
}

pub(super) fn dialog_text(locale: &str) -> &'static PairingDialogText {
    match locale {
        "zh_CN" => &ZH_CN,
        "zh_TW" => &ZH_TW,
        "ja" => &JA,
        "ko" => &KO,
        "de" => &DE,
        "fr" => &FR,
        "es" => &ES,
        "pt_BR" => &PT_BR,
        "ru" => &RU,
        _ => &EN,
    }
}

/// 连续拒绝到达阈值后的「不再提示」确认文案。
pub(super) fn stop_asking_dialog_text(locale: &str) -> &'static PairingDialogText {
    match locale {
        "zh_CN" => &STOP_ASKING_ZH_CN,
        "zh_TW" => &STOP_ASKING_ZH_TW,
        "ja" => &STOP_ASKING_JA,
        "ko" => &STOP_ASKING_KO,
        "de" => &STOP_ASKING_DE,
        "fr" => &STOP_ASKING_FR,
        "es" => &STOP_ASKING_ES,
        "pt_BR" => &STOP_ASKING_PT_BR,
        "ru" => &STOP_ASKING_RU,
        _ => &STOP_ASKING_EN,
    }
}

const EN: PairingDialogText = PairingDialogText {
    window_title: "Smart Preload",
    main_instruction: "Allow this extension to connect to the local app?",
    content: "Extension ID: {id}\n\n\
              Connecting lets it read hardware and process information, browser window titles \
              and activity, and hide or close its own preload windows.",
    confirm_button: "Connect this extension",
    decline_button: "Don't connect",
    footer: "Only allow this if you installed Smart Preload yourself. \
             You can check the ID on the chrome://extensions page.",
};

const ZH_CN: PairingDialogText = PairingDialogText {
    window_title: "智能预加载",
    main_instruction: "允许这个扩展连接本地 App 吗？",
    content: "扩展 ID：{id}\n\n\
              连接后，它可以读取硬件与进程信息、浏览器窗口标题与活动状态，\
              并隐藏或关闭它自己的预加载窗口。",
    confirm_button: "连接这个扩展",
    decline_button: "不连接",
    footer: "只有在你自己安装了智能预加载时才应允许。可在 chrome://extensions 页面核对该 ID。",
};

const ZH_TW: PairingDialogText = PairingDialogText {
    window_title: "智能預載",
    main_instruction: "允許這個擴充功能連線至本機 App 嗎？",
    content: "擴充功能 ID：{id}\n\n\
              連線後，它可以讀取硬體與處理程序資訊、瀏覽器視窗標題與活動狀態，\
              並隱藏或關閉它自己的預載視窗。",
    confirm_button: "連線這個擴充功能",
    decline_button: "不要連線",
    footer: "只有在你自己安裝了智能預載時才應允許。可在 chrome://extensions 頁面核對該 ID。",
};

const JA: PairingDialogText = PairingDialogText {
    window_title: "スマートプリロード",
    main_instruction: "この拡張機能がローカルアプリに接続することを許可しますか？",
    content: "拡張機能 ID: {id}\n\n\
              接続を許可すると、ハードウェアとプロセスの情報、ブラウザーのウィンドウ名と\
              アクティビティを読み取り、自身のプリロードウィンドウを非表示にしたり\
              閉じたりできるようになります。",
    confirm_button: "この拡張機能を接続する",
    decline_button: "接続しない",
    footer: "スマートプリロードをご自身でインストールした場合にのみ許可してください。\
             ID は chrome://extensions ページで確認できます。",
};

const KO: PairingDialogText = PairingDialogText {
    window_title: "스마트 프리로드",
    main_instruction: "이 확장 프로그램이 로컬 앱에 연결하도록 허용할까요?",
    content: "확장 프로그램 ID: {id}\n\n\
              연결하면 하드웨어 및 프로세스 정보, 브라우저 창 제목과 활동을 읽고 \
              자체 프리로드 창을 숨기거나 닫을 수 있습니다.",
    confirm_button: "이 확장 프로그램 연결",
    decline_button: "연결 안 함",
    footer: "스마트 프리로드를 직접 설치한 경우에만 허용하세요. \
             chrome://extensions 페이지에서 ID를 확인할 수 있습니다.",
};

const DE: PairingDialogText = PairingDialogText {
    window_title: "Intelligentes Vorladen",
    main_instruction: "Dieser Erweiterung die Verbindung zur lokalen App erlauben?",
    content: "Erweiterungs-ID: {id}\n\n\
              Nach dem Verbinden kann sie Hardware- und Prozessinformationen sowie \
              Browserfenstertitel und -aktivität lesen und ihre eigenen Vorladefenster \
              ausblenden oder schließen.",
    confirm_button: "Erweiterung verbinden",
    decline_button: "Nicht verbinden",
    footer: "Erlauben Sie dies nur, wenn Sie Intelligentes Vorladen selbst installiert haben. \
             Die ID können Sie unter chrome://extensions prüfen.",
};

const FR: PairingDialogText = PairingDialogText {
    window_title: "Préchargement intelligent",
    main_instruction: "Autoriser cette extension à se connecter à l'application locale ?",
    content: "Identifiant de l'extension : {id}\n\n\
              Une fois connectée, elle pourra lire les informations sur le matériel et les \
              processus, les titres et l'activité des fenêtres du navigateur, et masquer ou \
              fermer ses propres fenêtres de préchargement.",
    confirm_button: "Connecter cette extension",
    decline_button: "Ne pas connecter",
    footer: "N'autorisez ceci que si vous avez installé Préchargement intelligent vous-même. \
             Vous pouvez vérifier l'identifiant sur la page chrome://extensions.",
};

const ES: PairingDialogText = PairingDialogText {
    window_title: "Precarga inteligente",
    main_instruction: "¿Permitir que esta extensión se conecte a la aplicación local?",
    content: "ID de la extensión: {id}\n\n\
              Al conectarse podrá leer información del hardware y de los procesos, los títulos \
              y la actividad de las ventanas del navegador, y ocultar o cerrar sus propias \
              ventanas de precarga.",
    confirm_button: "Conectar esta extensión",
    decline_button: "No conectar",
    footer: "Permítelo solo si instalaste Precarga inteligente tú mismo. \
             Puedes comprobar el ID en la página chrome://extensions.",
};

const PT_BR: PairingDialogText = PairingDialogText {
    window_title: "Pré-carregamento inteligente",
    main_instruction: "Permitir que esta extensão se conecte ao app local?",
    content: "ID da extensão: {id}\n\n\
              Depois de conectada, ela poderá ler informações de hardware e de processos, \
              títulos e atividade das janelas do navegador, e ocultar ou fechar as próprias \
              janelas de pré-carregamento.",
    confirm_button: "Conectar esta extensão",
    decline_button: "Não conectar",
    footer: "Só permita se você mesmo instalou o Pré-carregamento inteligente. \
             Você pode conferir o ID na página chrome://extensions.",
};

const RU: PairingDialogText = PairingDialogText {
    window_title: "Умная предзагрузка",
    main_instruction: "Разрешить этому расширению подключиться к локальному приложению?",
    content: "Идентификатор расширения: {id}\n\n\
              После подключения оно сможет читать сведения об оборудовании и процессах, \
              заголовки и активность окон браузера, а также скрывать и закрывать собственные \
              окна предзагрузки.",
    confirm_button: "Подключить расширение",
    decline_button: "Не подключать",
    footer: "Разрешайте только если вы сами установили Умную предзагрузку. \
             Идентификатор можно проверить на странице chrome://extensions.",
};

// --- 「不再提示」确认 ---
//
// 场景：有人看到一个不认识的东西反复要权限，拒绝了几次，却不知道它是什么、怎么让它停。
// 连续拒绝到阈值后给一条明确出路：**关掉这个提示**，而不是卸载什么东西。
//
// 关掉之后仍可从托盘菜单手动发起配对 —— 出路必须是可逆的，正文里要写清楚怎么回来。
//
// `{count}` 由调用方替换成连续拒绝次数。

const STOP_ASKING_EN: PairingDialogText = PairingDialogText {
    window_title: "Smart Preload",
    main_instruction: "Stop asking about this connection?",
    content: "You have declined this connection {count} times.

              This local app is installed alongside the Smart Preload browser extension.               It provides features that need system access, such as hiding preload windows.

              If you stop the prompts, the extension keeps working without those features               and you will not be asked again.",
    confirm_button: "Stop asking",
    decline_button: "Keep asking",
    footer: "You can start pairing yourself at any time from the Smart Preload tray icon.",
};

const STOP_ASKING_ZH_CN: PairingDialogText = PairingDialogText {
    window_title: "智能预加载",
    main_instruction: "以后不再询问这个连接？",
    content: "你已经连续 {count} 次拒绝了这个连接请求。

              这个本地 App 是随智能预加载浏览器扩展一起安装的，              用于提供隐藏预加载窗口等需要系统权限的功能。

              关掉提示后，扩展本身继续可用，只是没有这些功能，也不会再弹这个窗口。",
    confirm_button: "不再提示",
    decline_button: "继续提示",
    footer: "随时可以从任务栏的智能预加载托盘图标里手动发起配对。",
};

const STOP_ASKING_ZH_TW: PairingDialogText = PairingDialogText {
    window_title: "智能預載",
    main_instruction: "以後不再詢問這個連線？",
    content: "你已經連續 {count} 次拒絕了這個連線請求。

              這個本機 App 是隨智能預載瀏覽器擴充功能一起安裝的，              用於提供隱藏預載視窗等需要系統權限的功能。

              關閉提示後，擴充功能本身繼續可用，只是沒有這些功能，也不會再彈這個視窗。",
    confirm_button: "不再提示",
    decline_button: "繼續提示",
    footer: "隨時可以從工作列的智能預載圖示手動發起配對。",
};

const STOP_ASKING_JA: PairingDialogText = PairingDialogText {
    window_title: "スマートプリロード",
    main_instruction: "この接続について今後は確認しないようにしますか？",
    content: "この接続要求を {count} 回続けて拒否しました。

              このローカルアプリはスマートプリロード拡張機能と一緒にインストールされ、              プリロードウィンドウの非表示など、システム権限が必要な機能を提供します。

              確認をやめると、拡張機能はこれらの機能なしで動作し続け、              このウィンドウも表示されなくなります。",
    confirm_button: "今後は確認しない",
    decline_button: "確認を続ける",
    footer: "通知領域のスマートプリロードのアイコンから、いつでも自分で接続を開始できます。",
};

const STOP_ASKING_KO: PairingDialogText = PairingDialogText {
    window_title: "스마트 프리로드",
    main_instruction: "이 연결에 대해 다시 묻지 않을까요?",
    content: "이 연결 요청을 {count}번 연속으로 거부했습니다.

              이 로컬 앱은 스마트 프리로드 확장 프로그램과 함께 설치되며,               프리로드 창 숨기기처럼 시스템 권한이 필요한 기능을 제공합니다.

              묻지 않도록 하면 확장 프로그램은 해당 기능 없이 계속 작동하고               이 창도 다시 나타나지 않습니다.",
    confirm_button: "다시 묻지 않기",
    decline_button: "계속 묻기",
    footer: "작업 표시줄의 스마트 프리로드 아이콘에서 언제든지 직접 연결을 시작할 수 있습니다.",
};

const STOP_ASKING_DE: PairingDialogText = PairingDialogText {
    window_title: "Intelligentes Vorladen",
    main_instruction: "Künftig nicht mehr nach dieser Verbindung fragen?",
    content: "Sie haben diese Verbindungsanfrage {count}-mal hintereinander abgelehnt.

              Diese lokale App wird zusammen mit der Browsererweiterung installiert und               stellt Funktionen bereit, die Systemzugriff benötigen, etwa das Ausblenden               von Vorladefenstern.

              Wenn Sie die Nachfragen beenden, funktioniert die Erweiterung ohne diese               Funktionen weiter und dieses Fenster erscheint nicht mehr.",
    confirm_button: "Nicht mehr fragen",
    decline_button: "Weiter fragen",
    footer: "Über das Infobereichssymbol von Intelligentes Vorladen können Sie die Verbindung              jederzeit selbst starten.",
};

const STOP_ASKING_FR: PairingDialogText = PairingDialogText {
    window_title: "Préchargement intelligent",
    main_instruction: "Ne plus demander pour cette connexion ?",
    content: "Vous avez refusé cette demande de connexion {count} fois de suite.

              Cette application locale est installée avec l'extension de navigateur et fournit               des fonctions nécessitant un accès système, comme masquer les fenêtres de               préchargement.

              Si vous arrêtez les demandes, l'extension continue de fonctionner sans ces               fonctions et cette fenêtre n'apparaîtra plus.",
    confirm_button: "Ne plus demander",
    decline_button: "Continuer à demander",
    footer: "Vous pouvez lancer l'association vous-même à tout moment depuis l'icône              Préchargement intelligent de la zone de notification.",
};

const STOP_ASKING_ES: PairingDialogText = PairingDialogText {
    window_title: "Precarga inteligente",
    main_instruction: "¿Dejar de preguntar por esta conexión?",
    content: "Has rechazado esta solicitud de conexión {count} veces seguidas.

              Esta aplicación local se instala junto con la extensión del navegador y ofrece               funciones que necesitan acceso al sistema, como ocultar las ventanas de precarga.

              Si dejas de recibir preguntas, la extensión sigue funcionando sin esas funciones               y esta ventana no volverá a aparecer.",
    confirm_button: "Dejar de preguntar",
    decline_button: "Seguir preguntando",
    footer: "Puedes iniciar la vinculación tú mismo cuando quieras desde el icono de Precarga              inteligente en el área de notificación.",
};

const STOP_ASKING_PT_BR: PairingDialogText = PairingDialogText {
    window_title: "Pré-carregamento inteligente",
    main_instruction: "Parar de perguntar sobre esta conexão?",
    content: "Você recusou esta solicitação de conexão {count} vezes seguidas.

              Este app local é instalado junto com a extensão do navegador e oferece recursos               que precisam de acesso ao sistema, como ocultar as janelas de pré-carregamento.

              Se parar de perguntar, a extensão continua funcionando sem esses recursos e               esta janela não aparece mais.",
    confirm_button: "Parar de perguntar",
    decline_button: "Continuar perguntando",
    footer: "Você pode iniciar o pareamento quando quiser pelo ícone do Pré-carregamento              inteligente na área de notificação.",
};

const STOP_ASKING_RU: PairingDialogText = PairingDialogText {
    window_title: "Умная предзагрузка",
    main_instruction: "Больше не спрашивать об этом подключении?",
    content: "Вы отклонили этот запрос на подключение {count} раза подряд.

              Это локальное приложение устанавливается вместе с расширением браузера и даёт               возможности, которым нужен доступ к системе, например скрытие окон предзагрузки.

              Если перестать спрашивать, расширение продолжит работать без этих возможностей,               и это окно больше не появится.",
    confirm_button: "Больше не спрашивать",
    decline_button: "Продолжать спрашивать",
    footer: "Начать связывание вручную можно в любой момент через значок «Умная предзагрузка»              в области уведомлений.",
};

/// 托盘菜单的文案。
///
/// 托盘菜单在 host 启动时构建一次，那时没有任何请求上下文，所以语言取自
/// `portable/ui-locale.txt`（上一次注册请求带来的语言），再回落到系统 UI 语言、英文。
/// 见 `api/state.rs` 的 `ui_locale()`。
pub(super) struct TrayMenuText {
    /// 手动发起配对。
    pub(super) pair: &'static str,
    /// 退出。原来是硬编码的 "Exit"，跟着一起本地化，免得同一个菜单里两种语言。
    pub(super) exit: &'static str,
    /// 没有找到可配对扩展时的提示（主指令）。
    pub(super) nothing_to_pair_title: &'static str,
    /// 同上的正文。
    pub(super) nothing_to_pair_body: &'static str,
}

pub(super) fn tray_menu_text(locale: &str) -> &'static TrayMenuText {
    match locale {
        "zh_CN" => &TRAY_ZH_CN,
        "zh_TW" => &TRAY_ZH_TW,
        "ja" => &TRAY_JA,
        "ko" => &TRAY_KO,
        "de" => &TRAY_DE,
        "fr" => &TRAY_FR,
        "es" => &TRAY_ES,
        "pt_BR" => &TRAY_PT_BR,
        "ru" => &TRAY_RU,
        _ => &TRAY_EN,
    }
}

const TRAY_EN: TrayMenuText = TrayMenuText {
    pair: "Pair browser extension...",
    exit: "Exit",
    nothing_to_pair_title: "No extension is waiting to be paired",
    nothing_to_pair_body: "Smart Preload was not found in any browser profile on this computer,                            or every installed copy is already paired.",
};

const TRAY_ZH_CN: TrayMenuText = TrayMenuText {
    pair: "配对浏览器扩展…",
    exit: "退出",
    nothing_to_pair_title: "没有等待配对的扩展",
    nothing_to_pair_body: "这台电脑的浏览器配置里没有找到智能预加载，或者已安装的都已经配对过了。",
};

const TRAY_ZH_TW: TrayMenuText = TrayMenuText {
    pair: "配對瀏覽器擴充功能…",
    exit: "結束",
    nothing_to_pair_title: "沒有等待配對的擴充功能",
    nothing_to_pair_body: "這台電腦的瀏覽器設定檔裡沒有找到智能預載，或者已安裝的都已經配對過了。",
};

const TRAY_JA: TrayMenuText = TrayMenuText {
    pair: "ブラウザー拡張機能を接続...",
    exit: "終了",
    nothing_to_pair_title: "接続待ちの拡張機能はありません",
    nothing_to_pair_body: "このコンピューターのブラウザープロファイルにスマートプリロードが                           見つからないか、インストール済みのものはすべて接続済みです。",
};

const TRAY_KO: TrayMenuText = TrayMenuText {
    pair: "브라우저 확장 프로그램 연결...",
    exit: "종료",
    nothing_to_pair_title: "연결을 기다리는 확장 프로그램이 없습니다",
    nothing_to_pair_body: "이 컴퓨터의 브라우저 프로필에서 스마트 프리로드를 찾지 못했거나,                            설치된 항목이 모두 이미 연결되어 있습니다.",
};

const TRAY_DE: TrayMenuText = TrayMenuText {
    pair: "Browsererweiterung verbinden ...",
    exit: "Beenden",
    nothing_to_pair_title: "Keine Erweiterung wartet auf eine Verbindung",
    nothing_to_pair_body: "Intelligentes Vorladen wurde in keinem Browserprofil auf diesem                            Computer gefunden, oder alle installierten Kopien sind bereits verbunden.",
};

const TRAY_FR: TrayMenuText = TrayMenuText {
    pair: "Associer l'extension de navigateur...",
    exit: "Quitter",
    nothing_to_pair_title: "Aucune extension n'attend d'être associée",
    nothing_to_pair_body: "Préchargement intelligent est introuvable dans les profils de                            navigateur de cet ordinateur, ou toutes les copies installées sont                            déjà associées.",
};

const TRAY_ES: TrayMenuText = TrayMenuText {
    pair: "Vincular extensión del navegador...",
    exit: "Salir",
    nothing_to_pair_title: "Ninguna extensión está esperando vinculación",
    nothing_to_pair_body: "No se encontró Precarga inteligente en ningún perfil de navegador de                            este equipo, o todas las copias instaladas ya están vinculadas.",
};

const TRAY_PT_BR: TrayMenuText = TrayMenuText {
    pair: "Parear extensão do navegador...",
    exit: "Sair",
    nothing_to_pair_title: "Nenhuma extensão aguardando pareamento",
    nothing_to_pair_body: "O Pré-carregamento inteligente não foi encontrado em nenhum perfil de                            navegador deste computador, ou todas as cópias instaladas já estão                            pareadas.",
};

const TRAY_RU: TrayMenuText = TrayMenuText {
    pair: "Связать расширение браузера...",
    exit: "Выход",
    nothing_to_pair_title: "Нет расширений, ожидающих связывания",
    nothing_to_pair_body: "«Умная предзагрузка» не найдена ни в одном профиле браузера на этом                            компьютере, либо все установленные копии уже связаны.",
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_supported_locale_has_its_own_text() {
        for locale in SUPPORTED_LOCALES {
            let text = dialog_text(locale);
            assert!(!text.main_instruction.is_empty(), "{locale} 缺主指令");
            assert!(
                text.content.contains("{id}"),
                "{locale} 的正文没有 {{id}} 占位符"
            );
            assert!(!text.confirm_button.is_empty(), "{locale} 缺确认按钮文字");
            assert!(!text.decline_button.is_empty(), "{locale} 缺拒绝按钮文字");
        }
    }

    /// 每个 locale 的文案必须真的不同 —— 漏翻会退化成英文却看不出来。
    #[test]
    fn locales_are_not_silently_falling_back_to_english() {
        for (label, pick) in [
            (
                "配对",
                dialog_text as fn(&str) -> &'static PairingDialogText,
            ),
            (
                "卸载",
                stop_asking_dialog_text as fn(&str) -> &'static PairingDialogText,
            ),
        ] {
            let english = pick("en").main_instruction;

            for locale in SUPPORTED_LOCALES.iter().filter(|value| **value != "en") {
                assert_ne!(
                    pick(locale).main_instruction,
                    english,
                    "{label}弹窗的 {locale} 主指令与英文相同 —— 要么漏翻了，要么 match 少了一条分支"
                );
            }
        }
    }

    /// 「不再提示」弹窗同样要每个语言都齐全，而且必须带拒绝次数的占位符。
    #[test]
    fn every_supported_locale_has_stop_asking_text() {
        for locale in SUPPORTED_LOCALES {
            let text = stop_asking_dialog_text(locale);
            assert!(
                !text.main_instruction.is_empty(),
                "{locale} 缺「不再提示」主指令"
            );
            assert!(
                text.content.contains("{count}"),
                "{locale} 的「不再提示」正文没有 {{count}} 占位符 —— 用户看不到自己拒绝了几次"
            );
            assert!(
                !text.confirm_button.is_empty(),
                "{locale} 缺卸载确认按钮文字"
            );
            assert!(
                !text.decline_button.is_empty(),
                "{locale} 缺卸载保留按钮文字"
            );
            // 关掉提示之后还能从托盘手动配对，页脚必须写明这条回来的路，
            // 否则用户会以为这是个不可逆的开关。
            assert!(!text.footer.is_empty(), "{locale} 缺「不再提示」页脚说明");
        }
    }

    /// 两个弹窗的文案不能串。
    #[test]
    fn the_two_dialogs_do_not_share_wording() {
        for locale in SUPPORTED_LOCALES {
            assert_ne!(
                dialog_text(locale).main_instruction,
                stop_asking_dialog_text(locale).main_instruction,
                "{locale} 的配对弹窗与「不再提示」弹窗主指令相同 —— 分派表里接错了"
            );
        }
    }

    #[test]
    fn locale_normalization_covers_the_forms_chrome_actually_sends() {
        assert_eq!(normalize_locale("zh_CN"), "zh_CN");
        assert_eq!(normalize_locale("zh-CN"), "zh_CN");
        assert_eq!(normalize_locale("zh"), "zh_CN");
        assert_eq!(normalize_locale("zh-HK"), "zh_TW");
        assert_eq!(normalize_locale("zh_TW"), "zh_TW");
        assert_eq!(normalize_locale("pt"), "pt_BR");
        assert_eq!(normalize_locale("pt-PT"), "pt_BR");
        assert_eq!(normalize_locale("en-GB"), "en");
        assert_eq!(normalize_locale("ja-JP"), "ja");
    }

    /// 认不出来的值必须回落英文，绝不能 panic —— 这个值是请求方提供的。
    #[test]
    fn hostile_locale_values_fall_back_to_english() {
        for hostile in ["", "   ", "kl", "../../etc", "\u{0}", &"a".repeat(4096)] {
            assert_eq!(
                normalize_locale(hostile),
                "en",
                "输入 {hostile:?} 没有回落英文"
            );
        }
    }
}
