import React from 'react';
import Dialog from './ui/Dialog';

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

const GROUPS = [
  ['Anywhere', [
    ['Add a request', [MOD, 'N']],
    ['Import requests', [MOD, 'I']],
    ['Search requests', [MOD, 'F']],
    ['Overview', [MOD, '1']],
    ['All requests', [MOD, '2']],
    ['Settings', [MOD, ',']],
    ['Collapse or expand the sidebar', [MOD, 'B']],
    ['Zoom in, out, reset', [MOD, '+ / − / 0']],
    ['Show this list', ['?']],
  ]],
  ['In the request table', [
    ['Move between requests', ['↑', '↓']],
    ['Open the request', ['Enter']],
    ['Select or unselect', ['Space']],
    ['Select a range', ['Shift', 'Click']],
    ['Select everything shown', [MOD, 'A']],
    ['Delete (with undo)', ['Delete']],
    ['Clear the selection', ['Esc']],
  ]],
  ['In a request', [
    ['Save changes', [MOD, 'S']],
    ['Close', ['Esc']],
  ]],
  ['Adding a request', [
    ['Add it', [MOD, 'Enter']],
  ]],
];

export default function ShortcutsDialog({ onClose }) {
  return (
    <Dialog title="Keyboard shortcuts" size="md" onClose={onClose}>
      {GROUPS.map(([title, shortcuts]) => (
        <div key={title} className="form-section">
          <h3 className="form-section-title">{title}</h3>
          <div className="shortcut-list">
            {shortcuts.map(([label, keys]) => (
              <React.Fragment key={label}>
                <span>{label}</span>
                <span className="shortcut-keys">{keys.map(key => <kbd key={key}>{key}</kbd>)}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}
    </Dialog>
  );
}
