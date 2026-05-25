import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  CheckCircle2,
  FileClock,
  Filter,
  Play,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldAlert,
  Terminal,
  XCircle
} from "lucide-react";
import { api } from "./api";
import {
  filterFlags,
  groupByCategory,
  hasHighRiskProductionChange,
  pendingToChanges,
  pendingValue,
  valueForEnvironment,
  type BuildFilter,
  type PendingChanges,
  type RiskFilter
} from "./state";
import type { CommandLog, DeployResponse, Environment, FeatureFlag, PreviewItem, ProjectResponse, ProjectSummary, SnapshotManifest, ValidationResponse } from "./types";
import "./styles.css";

const riskOptions: RiskFilter[] = ["all", "low", "medium", "high"];
const buildOptions: BuildFilter[] = ["all", "requiresBuild", "runtime"];

function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [environment, setEnvironment] = useState<Environment>("dev");
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [pending, setPending] = useState<PendingChanges>({});
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [buildFilter, setBuildFilter] = useState<BuildFilter>("all");
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [confirmProduction, setConfirmProduction] = useState(false);
  const [acknowledgeHighRisk, setAcknowledgeHighRisk] = useState(false);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [deployResult, setDeployResult] = useState<DeployResponse | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotManifest[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState("latest");
  const [status, setStatus] = useState<{ kind: "success" | "error" | "info"; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listProjects()
      .then((items) => {
        setProjects(items);
        setSelectedProjectId(items[0]?.projectId ?? "");
      })
      .catch((error: Error) => setStatus({ kind: "error", message: error.message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    setLoading(true);
    Promise.all([
      api.getProject(selectedProjectId),
      api.listFlags(selectedProjectId),
      api.listSnapshots(selectedProjectId)
    ])
      .then(([projectPayload, flagsPayload, snapshotsPayload]) => {
        setProject(projectPayload);
        setFlags(flagsPayload.flags);
        setSnapshots(snapshotsPayload.snapshots);
        setPending({});
        setPreview([]);
        setValidation(null);
        setDeployResult(null);
        setConfirmProduction(false);
        setAcknowledgeHighRisk(false);
      })
      .catch((error: Error) => setStatus({ kind: "error", message: error.message }))
      .finally(() => setLoading(false));
  }, [selectedProjectId]);

  useEffect(() => {
    setPending({});
    setPreview([]);
    setValidation(null);
    setDeployResult(null);
    setConfirmProduction(false);
    setAcknowledgeHighRisk(false);
  }, [environment]);

  const selectedProject = projects.find((item) => item.projectId === selectedProjectId);
  const changes = useMemo(() => pendingToChanges(flags, environment, pending), [flags, environment, pending]);
  const filteredFlags = useMemo(() => filterFlags(flags, { query, risk: riskFilter, build: buildFilter }), [flags, query, riskFilter, buildFilter]);
  const grouped = useMemo(() => groupByCategory(filteredFlags), [filteredFlags]);
  const previewHasHighRiskPrd = hasHighRiskProductionChange(preview);
  const pendingHasRiskyPrd = environment === "prd" && changes.some((change) => flags.find((flag) => flag.key === change.flagKey)?.risk === "high");
  const validationPassed = validation?.environment === environment && validation.validation.exitCode === 0 && changes.length === 0;

  function toggleFlag(flag: FeatureFlag) {
    const current = pendingValue(flag, environment, pending);
    const original = valueForEnvironment(flag, environment);
    const next = !current;
    setPending((previous) => {
      const copy = { ...previous };
      if (next === original) {
        delete copy[flag.key];
      } else {
        copy[flag.key] = next;
      }
      return copy;
    });
    setPreview([]);
    setValidation(null);
    setDeployResult(null);
  }

  async function refreshProject() {
    if (!selectedProjectId) return;
    const [flagsPayload, snapshotsPayload] = await Promise.all([
      api.listFlags(selectedProjectId),
      api.listSnapshots(selectedProjectId)
    ]);
    setFlags(flagsPayload.flags);
    setSnapshots(snapshotsPayload.snapshots);
  }

  async function openPreview() {
    if (!selectedProjectId || changes.length === 0) return;
    setBusy(true);
    try {
      const response = await api.preview(selectedProjectId, environment, changes);
      setPreview(response.previews);
      setIsPreviewOpen(true);
      setStatus({ kind: "info", message: "Preview generated. Review the diff before applying." });
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function applyChanges() {
    if (!selectedProjectId || preview.length === 0) return;
    setBusy(true);
    try {
      const response = await api.apply(selectedProjectId, environment, changes, {
        confirmProduction: environment === "prd" ? confirmProduction : undefined,
        acknowledgeHighRisk: previewHasHighRiskPrd ? acknowledgeHighRisk : undefined
      });
      await refreshProject();
      setPending({});
      setPreview([]);
      setIsPreviewOpen(false);
      setValidation(null);
      setDeployResult(null);
      setStatus({ kind: "success", message: `Applied ${response.results.length} change(s). Snapshot created before write.` });
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function validateEnvironment() {
    if (!selectedProjectId) return;
    setBusy(true);
    try {
      const response = await api.validate(selectedProjectId, environment);
      setValidation(response);
      setStatus(response.validation.exitCode === 0
        ? { kind: "success", message: `${environment.toUpperCase()} validation passed.` }
        : { kind: "error", message: `${environment.toUpperCase()} validation failed.` });
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function deployEnvironment() {
    if (!selectedProjectId || !validationPassed) return;
    if (environment === "prd" && !window.confirm("Deploy production environment using the command defined in the project contract?")) {
      return;
    }
    setBusy(true);
    try {
      const response = await api.deploy(selectedProjectId, environment, environment === "prd");
      setDeployResult(response);
      setStatus(response.blocked
        ? { kind: "error", message: "Deploy blocked because validation failed." }
        : { kind: "success", message: `${environment.toUpperCase()} deploy command completed.` });
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function rollbackSnapshot(snapshotId: string) {
    if (!selectedProjectId) return;
    if (!window.confirm(`Rollback ${selectedProjectId} to snapshot ${snapshotId}?`)) return;
    setBusy(true);
    try {
      await api.rollback(selectedProjectId, snapshotId);
      await refreshProject();
      setPending({});
      setPreview([]);
      setValidation(null);
      setDeployResult(null);
      setStatus({ kind: "success", message: `Rollback restored ${snapshotId}.` });
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span>Local-only</span>
          <strong>Feature Flag Control Center</strong>
        </div>
        <section>
          <h2>Projects</h2>
          <div className="project-list">
            {projects.map((item) => (
              <button key={item.projectId} className={item.projectId === selectedProjectId ? "project-button active" : "project-button"} onClick={() => setSelectedProjectId(item.projectId)}>
                <span>{item.displayName}</span>
                <small>{item.projectId}</small>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h2>Environment</h2>
          <div className="env-switch">
            {(["dev", "prd"] as Environment[]).map((item) => (
              <button key={item} className={environment === item ? `active ${item}` : item} onClick={() => setEnvironment(item)}>
                {item.toUpperCase()}
              </button>
            ))}
          </div>
        </section>
        <div className="local-warning">
          <ShieldAlert size={18} />
          <span>This dashboard is intended for localhost use only.</span>
        </div>
      </aside>

      <section className="content">
        <header className={`topbar env-${environment}`}>
          <div>
            <p className="eyebrow">Reusable dashboard</p>
            <h1>{selectedProject?.displayName ?? "Feature Flags"}</h1>
            <p>Changes are staged in the browser, then sent to the local API for preview, apply, validation, deploy, and rollback.</p>
          </div>
          <div className="env-pill">{environment.toUpperCase()}</div>
        </header>

        {status && (
          <div className={`status ${status.kind}`}>
            {status.kind === "success" ? <CheckCircle2 size={18} /> : status.kind === "error" ? <XCircle size={18} /> : <AlertTriangle size={18} />}
            <span>{status.message}</span>
          </div>
        )}

        {pendingHasRiskyPrd && (
          <div className="risk-alert">
            <ShieldAlert size={20} />
            <span>High-risk production change pending. Preview will require acknowledgement before apply.</span>
          </div>
        )}

        <section className="controls">
          <label className="search">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search flags, keys, owners, categories" />
          </label>
          <label>
            <Filter size={16} />
            <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as RiskFilter)}>
              {riskOptions.map((item) => <option key={item} value={item}>Risk: {item}</option>)}
            </select>
          </label>
          <label>
            <FileClock size={16} />
            <select value={buildFilter} onChange={(event) => setBuildFilter(event.target.value as BuildFilter)}>
              {buildOptions.map((item) => <option key={item} value={item}>{item === "all" ? "Build: all" : item}</option>)}
            </select>
          </label>
        </section>

        {loading ? (
          <div className="empty-state">Loading local API data...</div>
        ) : (
          <div className="category-stack">
            {Object.entries(grouped).map(([category, categoryFlags]) => (
              <section className="category" key={category}>
                <div className="category-heading">
                  <h2>{category}</h2>
                  <span>{categoryFlags.length} flags</span>
                </div>
                <div className="flag-grid">
                  {categoryFlags.map((flag) => {
                    const current = valueForEnvironment(flag, environment);
                    const next = pendingValue(flag, environment, pending);
                    const changed = current !== next;
                    return (
                      <article className={`flag-card risk-${flag.risk} ${changed ? "changed" : ""}`} key={flag.key}>
                        <div className="flag-head">
                          <div>
                            <h3>{flag.label}</h3>
                            <code>{flag.key}</code>
                          </div>
                          <button className={`toggle ${next ? "on" : ""}`} onClick={() => toggleFlag(flag)} aria-label={`Toggle ${flag.label}`}>
                            <span />
                          </button>
                        </div>
                        <p>{flag.description}</p>
                        <div className="badges">
                          <span className={`badge risk-${flag.risk}`}>{flag.risk}</span>
                          <span className={flag.requiresBuild ? "badge build" : "badge runtime"}>{flag.requiresBuild ? "requires build" : "runtime"}</span>
                          {flag.owner && <span className="badge owner">{flag.owner}</span>}
                        </div>
                        <div className="value-row">
                          <span>Current <strong>{String(current)}</strong></span>
                          <span>Pending <strong>{String(next)}</strong></span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <section className="lower-grid">
          <DeployPanel
            environment={environment}
            busy={busy}
            validation={validation}
            deployResult={deployResult}
            validationPassed={validationPassed}
            pendingCount={changes.length}
            onValidate={validateEnvironment}
            onDeploy={deployEnvironment}
          />
          <RollbackPanel snapshots={snapshots} selectedSnapshot={selectedSnapshot} setSelectedSnapshot={setSelectedSnapshot} onRollback={rollbackSnapshot} busy={busy} />
        </section>
      </section>

      <footer className="pending-bar">
        <span><strong>{changes.length}</strong> pending change(s)</span>
        <div>
          <button onClick={() => { setPending({}); setPreview([]); setValidation(null); }} disabled={changes.length === 0 || busy}>Reset</button>
          <button className="primary" onClick={openPreview} disabled={changes.length === 0 || busy}>Preview</button>
        </div>
      </footer>

      {isPreviewOpen && (
        <PreviewModal
          environment={environment}
          previews={preview}
          confirmProduction={confirmProduction}
          setConfirmProduction={setConfirmProduction}
          acknowledgeHighRisk={acknowledgeHighRisk}
          setAcknowledgeHighRisk={setAcknowledgeHighRisk}
          busy={busy}
          onApply={applyChanges}
          onClose={() => setIsPreviewOpen(false)}
        />
      )}
    </main>
  );
}

function DeployPanel(props: {
  environment: Environment;
  busy: boolean;
  validation: ValidationResponse | null;
  deployResult: DeployResponse | null;
  validationPassed: boolean;
  pendingCount: number;
  onValidate: () => void;
  onDeploy: () => void;
}) {
  const logs: CommandLog[] = [
    ...(props.validation ? [props.validation.validation] : []),
    ...(props.deployResult?.deploy ? [props.deployResult.deploy] : [])
  ];
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Deploy</h2>
          <p>Validation must pass before deploy is enabled.</p>
        </div>
        <Terminal size={20} />
      </div>
      <div className="action-row">
        <button onClick={props.onValidate} disabled={props.busy || props.pendingCount > 0}>Validate</button>
        <button className="primary" onClick={props.onDeploy} disabled={props.busy || !props.validationPassed}>
          <Play size={16} />
          Deploy {props.environment.toUpperCase()}
        </button>
      </div>
      <div className="validation-state">
        Latest validation: {props.validation ? (props.validation.validation.exitCode === 0 ? "passed" : "failed") : "not run"}
      </div>
      <CommandLogs logs={logs} />
    </section>
  );
}

function RollbackPanel(props: {
  snapshots: SnapshotManifest[];
  selectedSnapshot: string;
  setSelectedSnapshot: (snapshot: string) => void;
  onRollback: (snapshot: string) => void;
  busy: boolean;
}) {
  const latest = props.snapshots.at(-1)?.snapshotId ?? "latest";
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Rollback</h2>
          <p>Restore a known snapshot through the local API.</p>
        </div>
        <RotateCcw size={20} />
      </div>
      <select value={props.selectedSnapshot} onChange={(event) => props.setSelectedSnapshot(event.target.value)}>
        <option value="latest">latest</option>
        {props.snapshots.map((snapshot) => (
          <option key={snapshot.snapshotId} value={snapshot.snapshotId}>{snapshot.snapshotId}</option>
        ))}
      </select>
      <div className="action-row">
        <button onClick={() => props.onRollback("latest")} disabled={props.busy || props.snapshots.length === 0}>
          <RefreshCcw size={16} />
          Rollback latest
        </button>
        <button onClick={() => props.onRollback(props.selectedSnapshot)} disabled={props.busy || (props.selectedSnapshot !== "latest" && !props.selectedSnapshot)}>
          Rollback selected
        </button>
      </div>
      <div className="snapshot-list">
        {props.snapshots.length === 0 ? <span>No snapshots yet.</span> : props.snapshots.slice(-5).reverse().map((snapshot) => (
          <div key={snapshot.snapshotId}>
            <strong>{snapshot.snapshotId === latest ? "latest" : snapshot.flagKey}</strong>
            <small>{snapshot.createdAt} · {snapshot.environment}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function PreviewModal(props: {
  environment: Environment;
  previews: PreviewItem[];
  confirmProduction: boolean;
  setConfirmProduction: (value: boolean) => void;
  acknowledgeHighRisk: boolean;
  setAcknowledgeHighRisk: (value: boolean) => void;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const needsPrd = props.environment === "prd";
  const needsHighRisk = hasHighRiskProductionChange(props.previews);
  const canApply = (!needsPrd || props.confirmProduction) && (!needsHighRisk || props.acknowledgeHighRisk);
  const affectedFiles = Array.from(new Set(props.previews.flatMap((preview) => preview.writes)));
  const warnings = Array.from(new Set(props.previews.flatMap((preview) => preview.warnings)));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal">
        <header>
          <div>
            <p className="eyebrow">Preview changes</p>
            <h2>Before / After Diff</h2>
          </div>
          <button onClick={props.onClose}>Close</button>
        </header>
        {warnings.length > 0 && (
          <div className={needsHighRisk ? "risk-alert" : "warning-box"}>
            <ShieldAlert size={20} />
            <span>{warnings.join(" ")}</span>
          </div>
        )}
        <div className="diff-list">
          {props.previews.map((preview) => (
            <div className="diff-row" key={preview.change.flagKey}>
              <div>
                <strong>{preview.change.flag.label}</strong>
                <code>{preview.change.flagKey}</code>
              </div>
              <span>{preview.change.environment.toUpperCase()}</span>
              <del>{String(preview.change.from)}</del>
              <ins>{String(preview.change.to)}</ins>
            </div>
          ))}
        </div>
        <div className="affected-files">
          <h3>Affected files</h3>
          {affectedFiles.map((file) => <code key={file}>{file}</code>)}
        </div>
        {needsPrd && (
          <label className="check-row">
            <input type="checkbox" checked={props.confirmProduction} onChange={(event) => props.setConfirmProduction(event.target.checked)} />
            I confirm this production apply.
          </label>
        )}
        {needsHighRisk && (
          <label className="check-row high">
            <input type="checkbox" checked={props.acknowledgeHighRisk} onChange={(event) => props.setAcknowledgeHighRisk(event.target.checked)} />
            I acknowledge the high-risk production flag change.
          </label>
        )}
        <footer>
          <button onClick={props.onClose}>Review more</button>
          <button className="primary" onClick={props.onApply} disabled={props.busy || !canApply}>Apply changes</button>
        </footer>
      </section>
    </div>
  );
}

function CommandLogs({ logs }: { logs: CommandLog[] }) {
  if (logs.length === 0) {
    return <div className="logs empty">No command logs yet.</div>;
  }
  return (
    <div className="logs">
      {logs.map((log, index) => (
        <pre key={`${log.command}-${index}`}>{log.log}</pre>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
