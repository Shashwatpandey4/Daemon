import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { ActiveView } from "../App";

interface ArxivMeta {
  title: string;
  authors: string[];
  abstract: string;
  pdf_url: string;
}

interface Space {
  id: string;
  name: string;
  folder_path: string | null;
}

interface Props {
  onClose: () => void;
  onNavigate: (view: ActiveView) => void;
}

let db: Awaited<ReturnType<typeof Database.load>> | null = null;
async function getDb() {
  if (!db) db = await Database.load("sqlite:daemon.db");
  return db;
}

function parseArxivId(input: string): string | null {
  const trimmed = input.trim();
  // Full URL: https://arxiv.org/abs/2312.12345 or https://arxiv.org/pdf/2312.12345
  const urlMatch = trimmed.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]+(?:v\d+)?)/i);
  if (urlMatch) return urlMatch[1].replace(/v\d+$/, "");
  // Plain ID: 2312.12345 or 2312.12345v2
  const idMatch = trimmed.match(/^([0-9]{4}\.[0-9]+)(?:v\d+)?$/);
  if (idMatch) return idMatch[1];
  // Old-style: hep-th/9503124
  const oldMatch = trimmed.match(/^([a-z-]+\/[0-9]{7})(?:v\d+)?$/i);
  if (oldMatch) return oldMatch[1];
  return null;
}

export default function ArxivImportModal({ onClose, onNavigate }: Props) {
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<ArxivMeta | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>("__new__");
  const [newSpaceName, setNewSpaceName] = useState("");

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    (async () => {
      const db = await getDb();
      const rows = await db.select<Space[]>("SELECT id, name, folder_path FROM spaces ORDER BY created_at ASC");
      setSpaces(rows);
      if (rows.length > 0) setSelectedSpaceId(rows[0].id);
    })();
  }, []);

  async function handleFetch() {
    const id = parseArxivId(url);
    if (!id) { setFetchError("Enter a valid arXiv ID or URL (e.g. 2312.12345)"); return; }
    setFetching(true);
    setFetchError(null);
    setMeta(null);
    try {
      const result = await invoke<ArxivMeta>("fetch_arxiv_metadata", { arxivId: id });
      setMeta(result);
      if (!newSpaceName) setNewSpaceName(result.title.slice(0, 50));
    } catch (e) {
      setFetchError(String(e));
    } finally {
      setFetching(false);
    }
  }

  async function handleImport() {
    if (!meta) return;
    setImporting(true);
    setImportError(null);
    try {
      const db = await getDb();
      let spaceId: string;
      let folderPath: string | null = null;

      if (selectedSpaceId === "__new__") {
        const name = newSpaceName.trim() || meta.title.slice(0, 50);
        spaceId = crypto.randomUUID();
        try { folderPath = await invoke<string>("setup_space_folder", { name }); } catch { /* ignore */ }
        await db.execute(
          "INSERT INTO spaces (id, name, folder_path, created_at) VALUES (?, ?, ?, ?)",
          [spaceId, name, folderPath, Date.now()]
        );
      } else {
        spaceId = selectedSpaceId;
        folderPath = spaces.find(s => s.id === spaceId)?.folder_path ?? null;
      }

      // Ensure we have a folder for the space
      if (!folderPath) {
        const spaceName = selectedSpaceId === "__new__"
          ? (newSpaceName.trim() || meta.title.slice(0, 50))
          : (spaces.find(s => s.id === spaceId)?.name ?? spaceId);
        try {
          folderPath = await invoke<string>("setup_space_folder", { name: spaceName });
          await db.execute("UPDATE spaces SET folder_path = ? WHERE id = ?", [folderPath, spaceId]);
        } catch { /* ignore */ }
      }

      // Determine download destination
      const arxivId = parseArxivId(url)!;
      const fileName = `${arxivId.replace("/", "_")}.pdf`;
      const destPath = folderPath ? `${folderPath}/${fileName}` : `/tmp/${fileName}`;

      await invoke("download_file", { url: meta.pdf_url, destPath });

      // Create space node
      const nodeId = crypto.randomUUID();
      await db.execute(
        `INSERT INTO space_nodes (id, space_id, title, content, url, file_path, node_type, tags, pos_x, pos_y, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nodeId, spaceId, meta.title, meta.abstract, null, destPath, "file", JSON.stringify([]), 0, 0, Date.now()]
      );

      onClose();
      onNavigate({ type: "pdf", nodeId, filePath: destPath });
    } catch (e) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="search-backdrop" onClick={onClose}>
      <div
        className="arxiv-modal"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.key === "Escape" && onClose()}
      >
        <div className="arxiv-modal-header">
          <span className="arxiv-modal-title">Import from arXiv</span>
        </div>

        <div className="arxiv-url-row">
          <input
            ref={inputRef}
            className="arxiv-url-input"
            placeholder="arXiv ID or URL — e.g. 2312.12345 or https://arxiv.org/abs/…"
            value={url}
            onChange={e => { setUrl(e.target.value); setMeta(null); setFetchError(null); }}
            onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") handleFetch(); }}
          />
          <button
            className="arxiv-fetch-btn"
            onClick={handleFetch}
            disabled={fetching || !url.trim()}
          >
            {fetching ? "…" : "Preview"}
          </button>
        </div>

        {fetchError && <p className="arxiv-error">{fetchError}</p>}

        {meta && (
          <div className="arxiv-meta">
            <p className="arxiv-meta-title">{meta.title}</p>
            <p className="arxiv-meta-authors">{meta.authors.slice(0, 5).join(", ")}{meta.authors.length > 5 ? " et al." : ""}</p>
            <p className="arxiv-meta-abstract">{meta.abstract.slice(0, 300)}{meta.abstract.length > 300 ? "…" : ""}</p>
          </div>
        )}

        {meta && (
          <div className="arxiv-space-row">
            <label className="arxiv-space-label">Add to space</label>
            <select
              className="arxiv-space-select"
              value={selectedSpaceId}
              onChange={e => setSelectedSpaceId(e.target.value)}
            >
              {spaces.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              <option value="__new__">+ New space…</option>
            </select>
            {selectedSpaceId === "__new__" && (
              <input
                className="arxiv-new-space-input"
                placeholder="Space name"
                value={newSpaceName}
                onChange={e => setNewSpaceName(e.target.value)}
                onKeyDown={e => e.stopPropagation()}
              />
            )}
          </div>
        )}

        {importError && <p className="arxiv-error">{importError}</p>}

        <div className="arxiv-modal-actions">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          {meta && (
            <button
              className="arxiv-import-btn"
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? "Downloading…" : "Import PDF"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
