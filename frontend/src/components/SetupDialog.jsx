import React, { useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, DatabaseBackup, ExternalLink, FileSpreadsheet, KeyRound, Loader2, Plus } from 'lucide-react';
import Dialog from './ui/Dialog';
import Avatar from './ui/Avatar';
import { api } from '../api/client';
import { openExternal } from '../utils/osuLinks';

const OAUTH_SETTINGS_URL = 'https://osu.ppy.sh/home/account/edit#oauth';

// Shared by first-run setup and Settings: verify the credentials with osu!,
// then save them.
export async function testAndSaveCredentials(clientId, clientSecret) {
  try {
    const result = await api.post('/api/settings/test-credentials', { client_id: clientId.trim(), client_secret: clientSecret.trim() });
    if (!result?.ok) return { ok: false, error: result?.error || 'osu! did not accept these credentials.' };
  } catch (error) {
    return { ok: false, error: error.data?.error || error.message };
  }
  try {
    await api.post('/api/settings', { client_id: clientId.trim(), client_secret: clientSecret.trim() });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function OsuAppInstructions() {
  return (
    <ol className="setup-instructions">
      <li>
        Open your <button type="button" className="btn-link" onClick={() => openExternal(OAUTH_SETTINGS_URL)}>osu! account settings<ExternalLink size={12} /></button> and scroll to <strong>OAuth</strong>.
      </li>
      <li>Click <strong>New OAuth Application</strong>. Call it anything, for example “ReqTrac”.</li>
      <li>ReqTrac only reads public beatmap and profile data, so the callback URL isn’t used. Leave it empty, or enter <code>http://localhost</code> if osu! asks for one.</li>
      <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> into the fields below. They stay on this computer.</li>
    </ol>
  );
}

export default function SetupDialog({ isConfigured, connectedAccount, onFinished, onSkip, onAddRequest, onImport, onRestoreBackup, onSettingsChanged }) {
  const [step, setStep] = useState(isConfigured ? 1 : 0);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [identity, setIdentity] = useState('');
  const [account, setAccount] = useState(connectedAccount || null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  const saveCredentials = async (event) => {
    event?.preventDefault();
    if (!clientId.trim() || !clientSecret.trim() || isBusy) return;
    setIsBusy(true);
    setError('');
    window.dispatchEvent(new Event('reqtrac:api-activity'));
    const result = await testAndSaveCredentials(clientId, clientSecret);
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await onSettingsChanged();
    setStep(1);
  };

  const saveIdentity = async (event) => {
    event?.preventDefault();
    if (!identity.trim() || isBusy) return;
    setIsBusy(true);
    setError('');
    try {
      await api.post('/api/settings', { user: identity.trim() });
      const settings = await onSettingsChanged();
      setAccount(settings?.connectedAccount || null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const finish = (next) => {
    onFinished();
    next?.();
  };

  const steps = ['Connect osu!', 'Your account', 'Get started'];

  return (
    <Dialog
      title={step === 0 ? 'Welcome to osu!ReqTrac' : steps[step]}
      description={step === 0
        ? 'ReqTrac keeps track of the hitsounds, guest difficulties, and storyboards people ask you for. First, let it read beatmap details from osu!.'
        : step === 1
          ? 'Tell ReqTrac which osu! account is yours so it can spot your guest difficulties and leave you out of your own requester stats.'
          : 'You’re set. How would you like to start?'}
      size="lg"
      onClose={onSkip}
      busy={isBusy}
      closeOnBackdrop={false}
      footer={step < 2 ? (
        <>
          <span className="dialog-footer-start">Step {step + 1} of {steps.length}</span>
          <button type="button" className="btn btn-ghost" onClick={() => (step === 0 ? onSkip() : setStep(2))} disabled={isBusy}>
            {step === 0 ? 'Set up later' : 'Skip'}
          </button>
          {step === 0 ? (
            <button type="button" className="btn btn-primary" onClick={saveCredentials} disabled={isBusy || !clientId.trim() || !clientSecret.trim()}>
              {isBusy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}{isBusy ? 'Checking with osu!…' : 'Check and save'}
            </button>
          ) : account ? (
            <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>Continue<ArrowRight size={15} /></button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={saveIdentity} disabled={isBusy || !identity.trim()}>
              {isBusy && <Loader2 size={15} className="spin" />}{isBusy ? 'Looking up…' : 'Find my account'}
            </button>
          )}
        </>
      ) : null}
    >
      <div className="setup-steps" aria-hidden="true">
        {steps.map((label, index) => <span key={label} data-state={index < step ? 'done' : index === step ? 'current' : 'todo'} />)}
      </div>

      {step === 0 && (
        <form className="form-section" onSubmit={saveCredentials}>
          <OsuAppInstructions />
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="setup-client-id">Client ID</label>
              <input id="setup-client-id" className="input" inputMode="numeric" value={clientId} onChange={event => setClientId(event.target.value)} placeholder="e.g. 41234" autoComplete="off" data-autofocus />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="setup-client-secret">Client Secret</label>
              <input id="setup-client-secret" className="input" type="password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} placeholder="40 characters" autoComplete="off" />
            </div>
          </div>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          <p className="field-hint">No osu! API yet? You can still track requests by hand and connect later in Settings.</p>
        </form>
      )}

      {step === 1 && (
        <form className="form-section" onSubmit={saveIdentity}>
          {isConfigured && step === 1 && !account && (
            <div className="callout callout-success"><CheckCircle2 size={16} /><span>osu! accepted your credentials.</span></div>
          )}
          {account ? (
            <div className="panel-inset account-preview">
              <Avatar src={account.avatar} name={account.username} />
              <div>
                <div style={{ fontWeight: 650 }}>{account.username}</div>
                <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>osu! user #{account.id}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setAccount(null)}>Not you?</button>
            </div>
          ) : (
            <div className="field">
              <label className="field-label" htmlFor="setup-identity">Your osu! username or profile link</label>
              <input id="setup-identity" className="input" value={identity} onChange={event => setIdentity(event.target.value)} placeholder="e.g. Mahiru Shiina or https://osu.ppy.sh/users/…" autoComplete="off" data-autofocus />
              <span className="field-hint">Only used to recognise your own difficulties. ReqTrac never signs in as you.</span>
            </div>
          )}
        </form>
      )}

      {step === 2 && (
        <div className="choice-grid">
          <button type="button" className="choice-card" onClick={() => finish(onAddRequest)} data-autofocus>
            <Plus size={20} />
            <strong>Add your first request</strong>
            <span>Paste an osu! beatmap link.</span>
          </button>
          <button type="button" className="choice-card" onClick={() => finish(onImport)}>
            <FileSpreadsheet size={20} />
            <strong>Import what you have</strong>
            <span>From a spreadsheet, Google Sheet, or a list of links.</span>
          </button>
          <button type="button" className="choice-card" onClick={() => finish(onRestoreBackup)}>
            <DatabaseBackup size={20} />
            <strong>Restore a backup</strong>
            <span>Coming from another computer? Bring your backup.json.</span>
          </button>
          <button type="button" className="choice-card" onClick={() => finish()}>
            <ArrowRight size={20} />
            <strong>Look around first</strong>
            <span>Go to the overview.</span>
          </button>
        </div>
      )}

      {error && <div className="callout callout-danger" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
    </Dialog>
  );
}
