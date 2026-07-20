use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{
        CheckMenuItem, CheckMenuItemBuilder, Menu, MenuItem, MenuItemBuilder, PredefinedMenuItem,
        Submenu,
    },
    Emitter, Manager, Url, WebviewUrl, WindowEvent, Wry,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const DESKTOP_COMMAND_EVENT: &str = "towerforge:desktop-command";
const MAX_RECENT_PROJECTS: usize = 10;

struct StudioProcess(Mutex<Option<CommandChild>>);

impl Drop for StudioProcess {
    fn drop(&mut self) {
        if let Ok(child) = self.0.get_mut() {
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
        }
    }
}

#[derive(Debug, Clone)]
struct StudioSession {
    port: u16,
    token: String,
}

#[derive(Default)]
struct CurrentSession(Mutex<Option<StudioSession>>);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StudioUiState {
    project_name: String,
    dirty: bool,
    can_undo: bool,
    can_redo: bool,
    active_tab: String,
    #[serde(default = "default_language")]
    language: String,
}

fn default_language() -> String {
    "ru".to_string()
}

impl Default for StudioUiState {
    fn default() -> Self {
        Self {
            project_name: "TowerForge".to_string(),
            dirty: false,
            can_undo: false,
            can_redo: false,
            active_tab: "home".to_string(),
            language: default_language(),
        }
    }
}

#[derive(Default)]
struct DesktopRuntimeState {
    ui: Mutex<StudioUiState>,
    ui_ready: AtomicBool,
    pending_project_parent: Mutex<Option<PathBuf>>,
    allow_close: AtomicBool,
    allow_exit: AtomicBool,
    zoom: Mutex<f64>,
}

struct DynamicMenuItems {
    save: MenuItem<Wry>,
    undo: MenuItem<Wry>,
    redo: MenuItem<Wry>,
    tabs: Vec<(String, CheckMenuItem<Wry>)>,
}

#[derive(Default)]
struct MenuHandles(Mutex<Option<DynamicMenuItems>>);

#[derive(Debug, Deserialize)]
struct ReadyLine {
    #[serde(rename = "type")]
    kind: String,
    port: u16,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopFileState {
    #[serde(skip_serializing_if = "Option::is_none")]
    last_project_dir: Option<PathBuf>,
    #[serde(default)]
    recent_project_dirs: Vec<PathBuf>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatedProject {
    ok: bool,
    project_dir: PathBuf,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCommandPayload {
    id: String,
    recent_index: Option<usize>,
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn kill_existing(app: &tauri::AppHandle) {
    let child = {
        let state = app.state::<StudioProcess>();
        let mut process = state.0.lock().expect("studio process lock poisoned");
        process.take()
    };
    if let Some(child) = child {
        let _ = child.kill();
    }
}

fn parse_ready_line(line: &str) -> Option<u16> {
    let parsed = serde_json::from_str::<ReadyLine>(line).ok()?;
    (parsed.kind == "towerforge-studio-ready").then_some(parsed.port)
}

fn start_studio(
    app: &tauri::AppHandle,
    project_dir: Option<PathBuf>,
) -> Result<StudioSession, String> {
    kill_existing(app);

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let runtime_root = resource_dir.join("runtime");
    let user_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&user_data_dir).map_err(|error| error.to_string())?;

    let wrapper = runtime_root.join("packages/desktop/sidecar/studio-sidecar.mjs");
    let token = random_token()?;
    let mut args = vec![wrapper.to_string_lossy().to_string()];
    if let Some(project_dir) = project_dir {
        args.push("--project".to_string());
        args.push(project_dir.to_string_lossy().to_string());
    }

    let mut command = app
        .shell()
        .sidecar("node")
        .map_err(|error| error.to_string())?;
    command = command.args(args);
    command = command.env("PORT", "0");
    command = command.env("TOWERFORGE_DESKTOP", "1");
    command = command.env("TOWERFORGE_BUNDLED_RUNTIME", "1");
    command = command.env(
        "TOWERFORGE_RUNTIME_ROOT",
        runtime_root.to_string_lossy().to_string(),
    );
    command = command.env(
        "TOWERFORGE_USER_DATA_DIR",
        user_data_dir.to_string_lossy().to_string(),
    );
    command = command.env("TOWERFORGE_SESSION_TOKEN", token.clone());

    let (mut rx, child) = command.spawn().map_err(|error| error.to_string())?;
    let (ready_tx, ready_rx) = mpsc::channel::<u16>();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    print!("{text}");
                    for line in text.lines() {
                        if let Some(port) = parse_ready_line(line) {
                            let _ = ready_tx.send(port);
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => eprint!("{}", String::from_utf8_lossy(&bytes)),
                _ => {}
            }
        }
    });

    let port = ready_rx
        .recv_timeout(Duration::from_secs(20))
        .map_err(|_| "Timed out waiting for TowerForge Studio sidecar.".to_string())?;
    *app.state::<StudioProcess>()
        .0
        .lock()
        .expect("studio process lock poisoned") = Some(child);

    Ok(StudioSession { port, token })
}

fn studio_url(session: &StudioSession) -> Result<Url, String> {
    Url::parse(&format!(
        "http://127.0.0.1:{}/?desktopToken={}",
        session.port, session.token
    ))
    .map_err(|error| error.to_string())
}

fn navigate_to_studio(app: &tauri::AppHandle, session: &StudioSession) -> Result<(), String> {
    let url = studio_url(session)?;
    if let Some(window) = app.get_webview_window("main") {
        window.navigate(url).map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    } else {
        tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
            .title("TowerForge")
            .inner_size(1280.0, 820.0)
            .min_inner_size(960.0, 640.0)
            .build()
            .map_err(|error| error.to_string())?;
    }
    *app.state::<CurrentSession>()
        .0
        .lock()
        .expect("session lock poisoned") = Some(session.clone());
    Ok(())
}

fn reset_ui_state(app: &tauri::AppHandle) {
    let state = app.state::<DesktopRuntimeState>();
    *state.ui.lock().expect("desktop state lock poisoned") = StudioUiState::default();
    state.ui_ready.store(false, Ordering::SeqCst);
}

fn restart_with_project(app: &tauri::AppHandle, project_dir: PathBuf) -> Result<(), String> {
    if !project_dir.join("project.json").is_file() {
        return Err("Selected folder is not a TowerForge .tdproj project.".to_string());
    }
    reset_ui_state(app);
    let session = start_studio(app, Some(project_dir))?;
    navigate_to_studio(app, &session)?;
    install_menu(app).map_err(|error| error.to_string())
}

fn desktop_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("desktop-state.json"))
        .map_err(|error| error.to_string())
}

fn read_desktop_file_state(app: &tauri::AppHandle) -> DesktopFileState {
    let Ok(path) = desktop_state_path(app) else {
        return DesktopFileState::default();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return DesktopFileState::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn recent_projects(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    read_desktop_file_state(app)
        .recent_project_dirs
        .into_iter()
        .filter_map(|entry| {
            let resolved = entry.canonicalize().ok()?;
            (resolved.join("project.json").is_file() && seen.insert(resolved.clone()))
                .then_some(resolved)
        })
        .take(MAX_RECENT_PROJECTS)
        .collect()
}

fn clear_recent_projects(app: &tauri::AppHandle) -> Result<(), String> {
    let mut state = read_desktop_file_state(app);
    state.recent_project_dirs.clear();
    let path = desktop_state_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&state).map_err(|error| error.to_string())? + "\n";
    std::fs::write(&temp, text).map_err(|error| error.to_string())?;
    std::fs::rename(temp, path).map_err(|error| error.to_string())
}

fn project_label(project_dir: &Path) -> String {
    let name = project_dir
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Project");
    let parent = project_dir
        .parent()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    format!("{name} — {parent}")
}

fn item(
    app: &tauri::AppHandle,
    id: &str,
    label: &str,
    enabled: bool,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<Wry>> {
    let mut builder = MenuItemBuilder::with_id(id, label).enabled(enabled);
    if let Some(accelerator) = accelerator {
        builder = builder.accelerator(accelerator);
    }
    builder.build(app)
}

fn localized(language: &str, english: &'static str, russian: &'static str) -> &'static str {
    if language == "ru" {
        russian
    } else {
        english
    }
}

fn install_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let ui = app
        .state::<DesktopRuntimeState>()
        .ui
        .lock()
        .expect("desktop state lock poisoned")
        .clone();
    let language = ui.language.as_str();
    let new_project = item(
        app,
        "file.new",
        localized(language, "New Project...", "Новый проект…"),
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let open_project = item(
        app,
        "file.open",
        localized(language, "Open Project...", "Открыть проект…"),
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let save = item(
        app,
        "file.save",
        localized(language, "Save", "Сохранить"),
        ui.dirty,
        Some("CmdOrCtrl+S"),
    )?;
    let close = item(
        app,
        "lifecycle.close",
        localized(language, "Close Window", "Закрыть окно"),
        true,
        Some("CmdOrCtrl+W"),
    )?;
    #[cfg(not(target_os = "macos"))]
    let exit = item(
        app,
        "lifecycle.quit",
        localized(language, "Exit TowerForge", "Выйти из TowerForge"),
        true,
        None,
    )?;

    let recent = recent_projects(app);
    let mut recent_builder = tauri::menu::SubmenuBuilder::new(
        app,
        localized(language, "Open Recent", "Недавние проекты"),
    );
    for (index, project_dir) in recent.iter().enumerate() {
        let recent_item = item(
            app,
            &format!("file.recent.{index}"),
            &project_label(project_dir),
            true,
            None,
        )?;
        recent_builder = recent_builder.item(&recent_item);
    }
    if !recent.is_empty() {
        recent_builder = recent_builder.separator();
    }
    let clear_recent = item(
        app,
        "file.clear_recent",
        localized(language, "Clear Recent", "Очистить список"),
        !recent.is_empty(),
        None,
    )?;
    let recent_menu = recent_builder.item(&clear_recent).build()?;

    let file_builder = tauri::menu::SubmenuBuilder::new(app, localized(language, "File", "Файл"))
        .items(&[&new_project, &open_project, &recent_menu])
        .separator()
        .item(&save)
        .separator()
        .item(&close);
    #[cfg(not(target_os = "macos"))]
    let file_builder = file_builder.separator().item(&exit);
    let file_menu = file_builder.build()?;

    let undo = item(
        app,
        "edit.undo",
        localized(language, "Undo", "Отменить"),
        ui.can_undo,
        Some("CmdOrCtrl+Z"),
    )?;
    let redo = item(
        app,
        "edit.redo",
        localized(language, "Redo", "Повторить"),
        ui.can_redo,
        Some("CmdOrCtrl+Shift+Z"),
    )?;
    let edit_menu = tauri::menu::SubmenuBuilder::new(app, localized(language, "Edit", "Правка"))
        .items(&[&undo, &redo])
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let command_palette = item(
        app,
        "view.command_palette",
        localized(language, "Command Palette...", "Палитра команд…"),
        true,
        Some("CmdOrCtrl+K"),
    )?;
    let tab_specs = [
        ("home", localized(language, "Home", "Главная")),
        ("waves", localized(language, "Waves", "Волны")),
        ("enemies", localized(language, "Enemies", "Враги")),
        ("towers", localized(language, "Towers", "Башни")),
        ("missions", localized(language, "Missions", "Миссии")),
        ("worldmap", localized(language, "World Map", "Карта мира")),
        ("maps", localized(language, "Maps", "Карты")),
        ("playtest", localized(language, "Playtest", "Тестирование")),
        ("balance", localized(language, "Balance", "Баланс")),
        ("ai", localized(language, "AI Chat", "Чат с ИИ")),
        ("scripts", localized(language, "Scripts", "Скрипты")),
        ("assets", localized(language, "Assets", "Ресурсы")),
        ("settings", localized(language, "Settings", "Настройки")),
        (
            "buildtargets",
            localized(language, "Build Targets", "Цели сборки"),
        ),
    ];
    let mut tab_items = Vec::new();
    let mut navigate_builder =
        tauri::menu::SubmenuBuilder::new(app, localized(language, "Navigate", "Навигация"));
    for (tab, label) in tab_specs {
        let menu_item = CheckMenuItemBuilder::with_id(format!("navigate.{tab}"), label)
            .checked(ui.active_tab == tab)
            .build(app)?;
        navigate_builder = navigate_builder.item(&menu_item);
        tab_items.push((tab.to_string(), menu_item));
    }
    let navigate_menu = navigate_builder.build()?;
    let toggle_theme = item(
        app,
        "view.toggle_theme",
        localized(language, "Toggle Theme", "Сменить тему"),
        true,
        None,
    )?;
    let zoom_in = item(
        app,
        "view.zoom_in",
        localized(language, "Zoom In", "Увеличить"),
        true,
        Some("CmdOrCtrl++"),
    )?;
    let zoom_out = item(
        app,
        "view.zoom_out",
        localized(language, "Zoom Out", "Уменьшить"),
        true,
        Some("CmdOrCtrl+-"),
    )?;
    let zoom_reset = item(
        app,
        "view.zoom_reset",
        localized(language, "Actual Size", "Фактический размер"),
        true,
        Some("CmdOrCtrl+0"),
    )?;
    #[cfg(target_os = "macos")]
    let fullscreen_accelerator = "Ctrl+Cmd+F";
    #[cfg(not(target_os = "macos"))]
    let fullscreen_accelerator = "F11";
    let fullscreen = item(
        app,
        "view.fullscreen",
        localized(language, "Toggle Full Screen", "Полноэкранный режим"),
        true,
        Some(fullscreen_accelerator),
    )?;
    let view_menu = tauri::menu::SubmenuBuilder::new(app, localized(language, "View", "Вид"))
        .items(&[&command_palette, &navigate_menu])
        .separator()
        .item(&toggle_theme)
        .separator()
        .items(&[&zoom_in, &zoom_out, &zoom_reset])
        .separator()
        .item(&fullscreen)
        .build()?;

    let validate = item(
        app,
        "project.validate",
        localized(language, "Validate Project", "Проверить проект"),
        true,
        Some("CmdOrCtrl+Shift+V"),
    )?;
    let simulate = item(
        app,
        "project.simulate",
        localized(
            language,
            "Simulate Selected Mission",
            "Симулировать выбранную миссию",
        ),
        true,
        None,
    )?;
    let compile_maps = item(
        app,
        "project.compile_maps",
        localized(language, "Compile Maps", "Скомпилировать карты"),
        true,
        None,
    )?;
    let balance = item(
        app,
        "project.balance",
        localized(language, "Run Balance Analysis", "Анализ баланса"),
        true,
        None,
    )?;
    let playtest = item(
        app,
        "project.playtest",
        localized(language, "Playtest", "Тестирование"),
        true,
        None,
    )?;
    let build_targets = item(
        app,
        "project.build_targets",
        localized(language, "Build Targets", "Цели сборки"),
        true,
        None,
    )?;
    let ai_designer = item(
        app,
        "project.ai_designer",
        localized(language, "AI Chat", "Чат с ИИ"),
        true,
        None,
    )?;
    let project_menu =
        tauri::menu::SubmenuBuilder::new(app, localized(language, "Project", "Проект"))
            .items(&[&validate, &simulate, &compile_maps, &balance])
            .separator()
            .items(&[&playtest, &build_targets, &ai_designer])
            .build()?;

    #[cfg(target_os = "macos")]
    let minimize_accelerator = Some("Cmd+M");
    #[cfg(not(target_os = "macos"))]
    let minimize_accelerator = None;
    let minimize = item(
        app,
        "window.minimize",
        localized(language, "Minimize", "Свернуть"),
        true,
        minimize_accelerator,
    )?;
    let maximize = item(
        app,
        "window.maximize",
        localized(language, "Maximize", "Развернуть"),
        true,
        None,
    )?;
    let window_fullscreen = item(
        app,
        "window.fullscreen",
        localized(language, "Toggle Full Screen", "Полноэкранный режим"),
        true,
        None,
    )?;
    let mut window_builder =
        tauri::menu::SubmenuBuilder::new(app, localized(language, "Window", "Окно")).items(&[
            &minimize,
            &maximize,
            &window_fullscreen,
        ]);
    #[cfg(target_os = "macos")]
    {
        let bring_all = PredefinedMenuItem::bring_all_to_front(app, None)?;
        window_builder = window_builder.separator().item(&bring_all);
    }
    let window_menu = window_builder.build()?;

    let getting_started = item(
        app,
        "help.getting_started",
        localized(language, "TowerForge Help", "Справка TowerForge"),
        true,
        None,
    )?;
    let shortcuts = item(
        app,
        "help.keyboard_shortcuts",
        localized(language, "Keyboard Shortcuts", "Горячие клавиши"),
        true,
        None,
    )?;
    let help_builder =
        tauri::menu::SubmenuBuilder::new(app, localized(language, "Help", "Справка"))
            .items(&[&getting_started, &shortcuts]);
    #[cfg(not(target_os = "macos"))]
    let help_builder = {
        let about = item(
            app,
            "help.about",
            localized(language, "About TowerForge", "О TowerForge"),
            true,
            None,
        )?;
        help_builder.separator().item(&about)
    };
    let help_menu = help_builder.build()?;

    let menu = Menu::new(app)?;
    #[cfg(target_os = "macos")]
    {
        let about = PredefinedMenuItem::about(app, None, None)?;
        let settings = item(
            app,
            "app.settings",
            localized(language, "Settings...", "Настройки…"),
            true,
            Some("Cmd+,"),
        )?;
        let services = PredefinedMenuItem::services(app, None)?;
        let hide = PredefinedMenuItem::hide(app, None)?;
        let hide_others = PredefinedMenuItem::hide_others(app, None)?;
        let show_all = PredefinedMenuItem::show_all(app, None)?;
        let quit = item(
            app,
            "lifecycle.quit",
            localized(language, "Quit TowerForge", "Выйти из TowerForge"),
            true,
            Some("Cmd+Q"),
        )?;
        let separator_1 = PredefinedMenuItem::separator(app)?;
        let separator_2 = PredefinedMenuItem::separator(app)?;
        let separator_3 = PredefinedMenuItem::separator(app)?;
        let separator_4 = PredefinedMenuItem::separator(app)?;
        let app_menu = Submenu::with_items(
            app,
            "TowerForge",
            true,
            &[
                &about,
                &separator_1,
                &settings,
                &separator_2,
                &services,
                &separator_3,
                &hide,
                &hide_others,
                &show_all,
                &separator_4,
                &quit,
            ],
        )?;
        menu.append(&app_menu)?;
    }
    menu.append_items(&[
        &file_menu,
        &edit_menu,
        &view_menu,
        &project_menu,
        &window_menu,
        &help_menu,
    ])?;
    app.set_menu(menu)?;
    *app.state::<MenuHandles>()
        .0
        .lock()
        .expect("menu lock poisoned") = Some(DynamicMenuItems {
        save,
        undo,
        redo,
        tabs: tab_items,
    });
    Ok(())
}

fn format_window_title(project_name: &str, dirty: bool) -> String {
    let name = if project_name.trim().is_empty() {
        "Untitled"
    } else {
        project_name.trim()
    };
    format!("{name}{} — TowerForge", if dirty { " *" } else { "" })
}

fn dispatch_studio_command(app: &tauri::AppHandle, id: &str, recent_index: Option<usize>) {
    if let Some(window) = app.get_webview_window("main") {
        let payload = DesktopCommandPayload {
            id: id.to_string(),
            recent_index,
        };
        if let Err(error) = window.emit(DESKTOP_COMMAND_EVENT, payload) {
            eprintln!("Failed to dispatch desktop command {id}: {error}");
        }
    }
}

fn parse_recent_menu_index(id: &str) -> Option<usize> {
    id.strip_prefix("file.recent.")?.parse::<usize>().ok()
}

fn is_valid_project_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

fn apply_window_command(app: &tauri::AppHandle, id: &str) -> Result<bool, String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(false);
    };
    match id {
        "window.minimize" => window.minimize().map_err(|error| error.to_string())?,
        "window.maximize" => {
            if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize().map_err(|error| error.to_string())?;
            } else {
                window.maximize().map_err(|error| error.to_string())?;
            }
        }
        "window.fullscreen" | "view.fullscreen" => {
            let fullscreen = window.is_fullscreen().map_err(|error| error.to_string())?;
            window
                .set_fullscreen(!fullscreen)
                .map_err(|error| error.to_string())?;
        }
        "view.zoom_in" | "view.zoom_out" | "view.zoom_reset" => {
            let state = app.state::<DesktopRuntimeState>();
            let mut zoom = state.zoom.lock().expect("zoom lock poisoned");
            if *zoom == 0.0 {
                *zoom = 1.0;
            }
            *zoom = match id {
                "view.zoom_in" => (*zoom + 0.1).min(1.5),
                "view.zoom_out" => (*zoom - 0.1).max(0.75),
                _ => 1.0,
            };
            window.set_zoom(*zoom).map_err(|error| error.to_string())?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    if id == "lifecycle.quit" && app.get_webview_window("main").is_none() {
        app.state::<DesktopRuntimeState>()
            .allow_exit
            .store(true, Ordering::SeqCst);
        app.exit(0);
        return;
    }
    if let Some(index) = parse_recent_menu_index(id) {
        dispatch_studio_command(app, "file.open_recent", Some(index));
        return;
    }
    if id == "file.clear_recent" {
        if let Err(error) = clear_recent_projects(app)
            .and_then(|_| install_menu(app).map_err(|error| error.to_string()))
        {
            eprintln!("Failed to clear recent projects: {error}");
        }
        return;
    }
    match apply_window_command(app, id) {
        Ok(true) => return,
        Err(error) => {
            eprintln!("Desktop window command failed: {error}");
            return;
        }
        Ok(false) => {}
    }
    dispatch_studio_command(app, id, None);
}

#[tauri::command]
fn desktop_sync_ui_state(
    app: tauri::AppHandle,
    payload: StudioUiState,
    runtime: tauri::State<'_, DesktopRuntimeState>,
) -> Result<(), String> {
    let language_changed = {
        let mut current = runtime.ui.lock().expect("desktop state lock poisoned");
        let changed = current.language != payload.language;
        *current = payload.clone();
        changed
    };
    runtime.ui_ready.store(true, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_title(&format_window_title(&payload.project_name, payload.dirty))
            .map_err(|error| error.to_string())?;
    }
    if language_changed {
        install_menu(&app).map_err(|error| error.to_string())?;
        return Ok(());
    }
    if let Some(handles) = app
        .state::<MenuHandles>()
        .0
        .lock()
        .expect("menu lock poisoned")
        .as_ref()
    {
        handles
            .save
            .set_enabled(payload.dirty)
            .map_err(|error| error.to_string())?;
        handles
            .undo
            .set_enabled(payload.can_undo)
            .map_err(|error| error.to_string())?;
        handles
            .redo
            .set_enabled(payload.can_redo)
            .map_err(|error| error.to_string())?;
        for (tab, item) in &handles.tabs {
            item.set_checked(tab == &payload.active_tab)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn desktop_choose_project_parent(
    runtime: tauri::State<'_, DesktopRuntimeState>,
) -> Result<Option<String>, String> {
    let selected = rfd::FileDialog::new()
        .set_title("Choose Project Location")
        .pick_folder();
    *runtime
        .pending_project_parent
        .lock()
        .expect("project parent lock poisoned") = selected.clone();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn desktop_create_project(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, DesktopRuntimeState>,
    name: String,
    template_name: String,
) -> Result<String, String> {
    if !is_valid_project_name(&name) {
        return Err(
            "Use 1-80 letters, digits, hyphens, or underscores for the project name.".to_string(),
        );
    }
    if !matches!(
        template_name.as_str(),
        "classic" | "maze" | "idle" | "roguelike"
    ) {
        return Err("Unknown project template.".to_string());
    }
    let parent = runtime
        .pending_project_parent
        .lock()
        .expect("project parent lock poisoned")
        .clone()
        .ok_or_else(|| "Choose a project location first.".to_string())?;
    if !parent.is_dir() {
        return Err("The selected project location is no longer available.".to_string());
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let runtime_root = resource_dir.join("runtime");
    let wrapper = runtime_root.join("packages/desktop/sidecar/create-project.mjs");
    let output = app
        .shell()
        .sidecar("node")
        .map_err(|error| error.to_string())?
        .args([
            wrapper.to_string_lossy().to_string(),
            "--parent".to_string(),
            parent.to_string_lossy().to_string(),
            "--name".to_string(),
            name,
            "--template".to_string(),
            template_name,
        ])
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: CreatedProject =
        serde_json::from_str(stdout.trim()).map_err(|error| error.to_string())?;
    if !result.ok {
        return Err("Project creation failed.".to_string());
    }
    *runtime
        .pending_project_parent
        .lock()
        .expect("project parent lock poisoned") = None;
    restart_with_project(&app, result.project_dir.clone())?;
    Ok(result.project_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn desktop_open_project(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(project_dir) = rfd::FileDialog::new()
        .set_title("Open .tdproj Project")
        .pick_folder()
    else {
        return Ok(None);
    };
    restart_with_project(&app, project_dir.clone())?;
    Ok(Some(project_dir.to_string_lossy().to_string()))
}

#[tauri::command]
fn desktop_open_recent(app: tauri::AppHandle, recent_index: usize) -> Result<String, String> {
    let project_dir = recent_projects(&app)
        .get(recent_index)
        .cloned()
        .ok_or_else(|| "That recent project is no longer available.".to_string())?;
    restart_with_project(&app, project_dir.clone())?;
    Ok(project_dir.to_string_lossy().to_string())
}

fn is_allowed_external_url(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && matches!(
                url.host_str(),
                Some(
                    "github.com"
                        | "lindforge.com"
                        | "www.lindforge.com"
                        | "t.me"
                        | "auth.openai.com"
                        | "chatgpt.com"
                        | "platform.openai.com"
                )
            )
    })
}

#[tauri::command]
fn desktop_open_external(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("That external link is not allowed.".to_string());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_finish_lifecycle(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, DesktopRuntimeState>,
    action: String,
) -> Result<(), String> {
    runtime
        .ui
        .lock()
        .expect("desktop state lock poisoned")
        .dirty = false;
    match action.as_str() {
        "quit" => {
            runtime.allow_exit.store(true, Ordering::SeqCst);
            app.exit(0);
        }
        "close" => {
            #[cfg(target_os = "macos")]
            {
                runtime.allow_close.store(true, Ordering::SeqCst);
                if let Some(window) = app.get_webview_window("main") {
                    window.close().map_err(|error| error.to_string())?;
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                runtime.allow_exit.store(true, Ordering::SeqCst);
                app.exit(0);
            }
        }
        _ => return Err("Unknown lifecycle action.".to_string()),
    }
    Ok(())
}

fn should_guard_lifecycle(app: &tauri::AppHandle) -> bool {
    let state = app.state::<DesktopRuntimeState>();
    let ui_ready = state.ui_ready.load(Ordering::SeqCst);
    let dirty = state.ui.lock().expect("desktop state lock poisoned").dirty;
    should_guard_values(ui_ready, dirty)
}

fn should_guard_values(ui_ready: bool, dirty: bool) -> bool {
    ui_ready && dirty
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(StudioProcess(Mutex::new(None)))
        .manage(CurrentSession::default())
        .manage(DesktopRuntimeState::default())
        .manage(MenuHandles::default())
        .invoke_handler(tauri::generate_handler![
            desktop_sync_ui_state,
            desktop_choose_project_parent,
            desktop_create_project,
            desktop_open_project,
            desktop_open_recent,
            desktop_open_external,
            desktop_finish_lifecycle,
        ])
        .setup(|app| {
            app.on_menu_event(handle_menu_event);
            let session = start_studio(app.handle(), None)
                .map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?;
            navigate_to_studio(app.handle(), &session)
                .map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?;
            install_menu(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building TowerForge desktop app");

    app.run(|app, event| match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            let state = app.state::<DesktopRuntimeState>();
            if state.allow_close.swap(false, Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            if should_guard_lifecycle(app) {
                dispatch_studio_command(app, "lifecycle.close", None);
            } else {
                #[cfg(target_os = "macos")]
                {
                    state.allow_close.store(true, Ordering::SeqCst);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.close();
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    state.allow_exit.store(true, Ordering::SeqCst);
                    app.exit(0);
                }
            }
        }
        tauri::RunEvent::ExitRequested { api, .. } => {
            let state = app.state::<DesktopRuntimeState>();
            if state.allow_exit.swap(false, Ordering::SeqCst) {
                return;
            }
            if should_guard_lifecycle(app) {
                api.prevent_exit();
                dispatch_studio_command(app, "lifecycle.quit", None);
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } if !has_visible_windows => {
            let session = app
                .state::<CurrentSession>()
                .0
                .lock()
                .expect("session lock poisoned")
                .clone();
            if let Some(session) = session {
                let _ = navigate_to_studio(app, &session);
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::{
        format_window_title, is_allowed_external_url, is_valid_project_name,
        parse_recent_menu_index, should_guard_values,
    };

    #[test]
    fn formats_clean_and_dirty_titles() {
        assert_eq!(
            format_window_title("Starter", false),
            "Starter — TowerForge"
        );
        assert_eq!(
            format_window_title("Starter", true),
            "Starter * — TowerForge"
        );
        assert_eq!(format_window_title("  ", false), "Untitled — TowerForge");
    }

    #[test]
    fn parses_only_recent_project_menu_ids() {
        assert_eq!(parse_recent_menu_index("file.recent.4"), Some(4));
        assert_eq!(parse_recent_menu_index("file.open"), None);
        assert_eq!(parse_recent_menu_index("file.recent.bad"), None);
    }

    #[test]
    fn validates_project_names_without_path_components() {
        assert!(is_valid_project_name("tower_game-2"));
        assert!(!is_valid_project_name("../tower"));
        assert!(!is_valid_project_name("tower/game"));
        assert!(!is_valid_project_name(""));
    }

    #[test]
    fn guards_only_ready_dirty_sessions() {
        assert!(should_guard_values(true, true));
        assert!(!should_guard_values(true, false));
        assert!(!should_guard_values(false, true));
    }

    #[test]
    fn allows_only_expected_https_link_hosts() {
        assert!(is_allowed_external_url(
            "https://github.com/Lindforge-Studios/TowerForge"
        ));
        assert!(is_allowed_external_url("https://lindforge.com"));
        assert!(is_allowed_external_url("https://t.me/lindforge"));
        assert!(is_allowed_external_url(
            "https://auth.openai.com/oauth/authorize?client_id=towerforge"
        ));
        assert!(!is_allowed_external_url("http://lindforge.com"));
        assert!(!is_allowed_external_url("https://example.com"));
        assert!(!is_allowed_external_url("file:///tmp/project.json"));
    }
}
