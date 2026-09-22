// 维护批次与回退核对台：批次登记（整批拒绝规则）、开始冻结、结束复核与回退记录。
import { useMemo, useState } from 'react';
import {
  BATCH_STATUS, STATUS_LABEL, TYPE_META, edgeKey, isCoreRouter
} from '../rules/maintenance.js';

const fmtWindow = (w) => {
  const f = (s) => String(s).replace('T', ' ').slice(5, 16);
  return `${f(w.start)} → ${f(w.end)}`;
};
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';

export default function BatchConsole({
  open, onClose, topology, batches, active, onRegister, onStart, onFinish, onCancel, onRemove
}) {
  const today = new Date().toISOString().slice(0, 11);
  const [form, setForm] = useState({
    name: '', owner: '',
    start: `${today}22:00`, end: `${today}23:00`,
    deviceIds: [], backupA: '', backupB: ''
  });
  const [errors, setErrors] = useState([]);

  const lockedIds = useMemo(() => new Set(active?.deviceIds || []), [active]);

  if (!open) return null;

  const toggleDevice = (id) => {
    setForm((f) => ({
      ...f,
      deviceIds: f.deviceIds.includes(id)
        ? f.deviceIds.filter((d) => d !== id)
        : [...f.deviceIds, id]
    }));
    setErrors([]);
  };

  const patch = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors([]); };

  const submit = () => {
    const draft = {
      name: form.name,
      owner: form.owner,
      window: { start: form.start, end: form.end },
      deviceIds: form.deviceIds,
      backupLink: [form.backupA, form.backupB]
    };
    const r = onRegister(draft, topology);
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors([]);
    setForm({ name: '', owner: '', start: form.start, end: form.end,
      deviceIds: [], backupA: '', backupB: '' });
  };

  const sorted = [...batches].sort((a, b) => {
    const rank = { [BATCH_STATUS.ACTIVE]: 0, [BATCH_STATUS.REGISTERED]: 1,
      [BATCH_STATUS.COMPLETED]: 2, [BATCH_STATUS.ROLLED_BACK]: 3 };
    return rank[a.status] - rank[b.status] || (a.createdAt < b.createdAt ? 1 : -1);
  });

  const nameOf = (id) => topology.nodes.find((n) => n.id === id)?.name || id;
  const touchesCore = form.deviceIds.some((id) => isCoreRouter(topology, id));

  return (
    <div className="console-mask" onClick={onClose}>
      <div className="console" onClick={(e) => e.stopPropagation()}>
        <header className="console-head">
          <div>
            <strong>设备维护批次与回退核对台</strong>
            <small>登记设备 · 维护时段 · 责任人 · 备用链路 · 结束前复核可达核心路由器</small>
          </div>
          <button className="console-close" onClick={onClose}>×</button>
        </header>

        <div className="console-body">
          <section className="console-form">
            <div className="console-sub">登记新批次</div>
            <div className="form-grid">
              <label className="span2">批次名称
                <input value={form.name} placeholder="例如：核心交换机固件升级"
                  onChange={(e) => patch('name', e.target.value)} />
              </label>
              <label>责任人
                <input value={form.owner} placeholder="值班工程师姓名"
                  onChange={(e) => patch('owner', e.target.value)} />
              </label>
              <label>维护时段
                <span className="window-inputs">
                  <input type="datetime-local" value={form.start}
                    onChange={(e) => patch('start', e.target.value)} />
                  <i>至</i>
                  <input type="datetime-local" value={form.end}
                    onChange={(e) => patch('end', e.target.value)} />
                </span>
              </label>
            </div>

            <div className="pick-block">
              <div className="pick-title"><span>登记设备</span>
                <small>{form.deviceIds.length} 台{touchesCore ? ' · 含核心路由器，必须填备用链路' : ''}</small></div>
              <div className="chip-row">
                {topology.nodes.map((n) => (
                  <button key={n.id} type="button"
                    className={'chip' + (form.deviceIds.includes(n.id) ? ' on' : '') +
                      (lockedIds.has(n.id) ? ' busy' : '')}
                    onClick={() => toggleDevice(n.id)}
                    title={lockedIds.has(n.id) ? `正在批次 ${active.code} 维护中` : ''}>
                    <i className={n.type}>{TYPE_META[n.type]?.icon}</i>
                    {n.name}
                    {lockedIds.has(n.id) && ' 🔒'}
                  </button>
                ))}
              </div>
            </div>

            <div className="pick-block">
              <div className="pick-title"><span>备用链路（选填）</span>
                <small>涉及核心路由器时强制</small></div>
              <div className="backup-row">
                <select value={form.backupA} onChange={(e) => patch('backupA', e.target.value)}>
                  <option value="">选择端点 A</option>
                  {topology.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
                <i>⌁</i>
                <select value={form.backupB} onChange={(e) => patch('backupB', e.target.value)}>
                  <option value="">选择端点 B</option>
                  {topology.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </div>
            </div>

            {errors.length > 0 && (
              <div className="batch-errors">
                <strong>整批拒绝，原图保留：</strong>
                <ul>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
              </div>
            )}

            <div className="rule-hint">
              判定规则：① 设备维护时段与其他未结束批次交叠即整批拒绝；
              ② 涉及核心路由器但未登记有效备用链路即整批拒绝。
              开始维护后冻结设备属性与相关链路，结束前复核每台设备可达核心路由器，失败自动恢复快照。
            </div>

            <div className="form-actions">
              <button className="primary" onClick={submit}>登记批次</button>
            </div>
          </section>

          <section className="console-list">
            <div className="console-sub">
              批次记录
              <small>{batches.filter((b) => b.status === BATCH_STATUS.ACTIVE).length} 个进行中 ·{' '}
                {batches.filter((b) => b.status === BATCH_STATUS.REGISTERED).length} 个待开始</small>
            </div>
            {sorted.length === 0 && <p className="hint">还没有维护批次</p>}
            {sorted.map((b) => {
              const backupExists = b.backupLink &&
                topology.nodes.some((n) => n.id === b.backupLink[0]) &&
                topology.nodes.some((n) => n.id === b.backupLink[1]);
              const backupLive = b.backupLink &&
                topology.edges.some(([a, z]) => edgeKey(a, z) === edgeKey(b.backupLink[0], b.backupLink[1]));
              return (
                <article key={b.id} className={'batch-card st-' + b.status}>
                  <div className="batch-card-head">
                    <strong>{b.code}</strong>
                    <span className={'badge ' + b.status}>{STATUS_LABEL[b.status]}</span>
                  </div>
                  <div className="batch-name">{b.name}</div>
                  <dl className="batch-meta">
                    <dt>责任人</dt><dd>{b.owner}</dd>
                    <dt>时段</dt><dd>{fmtWindow(b.window)}</dd>
                    <dt>设备</dt>
                    <dd>{b.deviceIds.map((id) => nameOf(id) +
                      (lockedIds.has(id) && b.id === active?.id ? ' 🔒' : '')).join('、')}</dd>
                    <dt>备用链路</dt>
                    <dd>{b.backupLink
                      ? `${nameOf(b.backupLink[0])} ⌁ ${nameOf(b.backupLink[1])}` +
                        (b.status === BATCH_STATUS.ACTIVE
                          ? backupLive ? '（已接通）' : backupExists ? '（尚未接通）' : '（端点缺失）'
                          : '')
                      : '—'}</dd>
                    {b.startedAt && <><dt>开始于</dt><dd>{fmtTime(b.startedAt)}</dd></>}
                    {b.finishedAt && <><dt>结束于</dt><dd>{fmtTime(b.finishedAt)}</dd></>}
                  </dl>

                  {b.status === BATCH_STATUS.ACTIVE && (
                    <div className="snapshot-note">
                      冻结快照：{b.deviceIds.length} 台设备及相关链路已锁定，属性与设备移除均被禁止。
                    </div>
                  )}
                  {b.status === BATCH_STATUS.ROLLED_BACK && b.reason && (
                    <div className="rollback-reason">↺ {b.reason}</div>
                  )}
                  {b.status === BATCH_STATUS.COMPLETED && (
                    <div className="complete-note">✓ 复核通过，全部设备可达核心路由器。</div>
                  )}

                  <div className="batch-actions">
                    {b.status === BATCH_STATUS.REGISTERED && (
                      <button className="primary small" disabled={!!active}
                        title={active ? '已有批次正在维护，需先结束' : ''}
                        onClick={() => onStart(b.id)}>开始维护（冻结）</button>
                    )}
                    {b.status === BATCH_STATUS.REGISTERED && (
                      <button className="small" onClick={() => onCancel(b.id)}>取消登记</button>
                    )}
                    {b.status === BATCH_STATUS.ACTIVE && (
                      <button className="primary small" onClick={() => onFinish(b.id)}>
                        结束并复核可达性
                      </button>
                    )}
                    {(b.status === BATCH_STATUS.COMPLETED || b.status === BATCH_STATUS.ROLLED_BACK) && (
                      <button className="small ghost" onClick={() => onRemove(b.id)}>删除记录</button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
