use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::post, Json, Router};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc};

const SERVICE_TYPE: &str = "_daemon._tcp.local.";
const SERVICE_NAME: &str = "daemon-sync";
const HTTP_PORT: u16 = 9001;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Todo {
    pub id: String,
    pub title: String,
    pub completed: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted: bool,
}

#[derive(Clone)]
struct AppState {
    db_path: Arc<PathBuf>,
}

fn ensure_table(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0
        )",
    )
    .expect("ensure table");
}

fn load_all_todos(conn: &Connection) -> Vec<Todo> {
    let mut stmt = conn
        .prepare("SELECT id, title, completed, created_at, updated_at, deleted FROM todos")
        .unwrap();
    stmt.query_map([], |row| {
        Ok(Todo {
            id: row.get(0)?,
            title: row.get(1)?,
            completed: row.get::<_, i64>(2)? != 0,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            deleted: row.get::<_, i64>(5)? != 0,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

fn upsert_todos(conn: &Connection, todos: &[Todo]) {
    for t in todos {
        conn.execute(
            "INSERT INTO todos (id, title, completed, created_at, updated_at, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               title      = CASE WHEN excluded.updated_at > todos.updated_at THEN excluded.title      ELSE todos.title      END,
               completed  = CASE WHEN excluded.updated_at > todos.updated_at THEN excluded.completed  ELSE todos.completed  END,
               updated_at = MAX(todos.updated_at, excluded.updated_at),
               deleted    = CASE WHEN excluded.updated_at > todos.updated_at THEN excluded.deleted    ELSE todos.deleted    END",
            params![
                t.id,
                t.title,
                t.completed as i64,
                t.created_at,
                t.updated_at,
                t.deleted as i64
            ],
        )
        .ok();
    }
}

async fn sync_handler(
    State(state): State<AppState>,
    Json(mobile_todos): Json<Vec<Todo>>,
) -> impl IntoResponse {
    println!("[sync] received {} todos from mobile", mobile_todos.len());

    let conn = Connection::open(state.db_path.as_ref()).expect("open db");
    ensure_table(&conn);
    upsert_todos(&conn, &mobile_todos);
    let merged = load_all_todos(&conn);

    println!("[sync] sending {} merged todos back", merged.len());
    (StatusCode::OK, Json(merged))
}

pub fn advertise_and_serve(db_path: PathBuf) {
    let db_path = Arc::new(db_path);
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async move {
            let state = AppState { db_path };

            let app = Router::new()
                .route("/sync", post(sync_handler))
                .with_state(state);

            let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{HTTP_PORT}"))
                .await
                .expect("bind port");
            println!("[sync] HTTP server listening on port {HTTP_PORT}");

            // Advertise via mDNS
            let local_ip = local_ip_address::local_ip().expect("local ip");
            let mdns = ServiceDaemon::new().expect("mdns daemon");
            let service = ServiceInfo::new(
                SERVICE_TYPE,
                SERVICE_NAME,
                "daemon-desktop.local.",
                local_ip,
                HTTP_PORT,
                None,
            )
            .expect("service info");
            mdns.register(service).expect("mdns register");
            println!("[sync] mDNS advertising on {local_ip}:{HTTP_PORT}");

            axum::serve(listener, app).await.unwrap();
        });
    });
}
