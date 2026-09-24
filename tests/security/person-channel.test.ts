/**
 * tests/security/person-channel.test.ts — the command line is a person channel
 * only in a terminal no agent host or agent-capable editor controls, and only
 * when that can be established: an editor's integrated terminal, an agent
 * host's terminal pane, or a process tree that cannot be read all count as a
 * relay.
 *
 * The process lines below are `ps -o args=` output as recorded on macOS and
 * Linux, with the home directory shortened to /Users/me.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { agentAncestorOf, channelFor, isAgentProcess, relayMarkerIn, systemPs, UNREADABLE_ANCESTRY, type PsRunner } from '../../src/cli/person-channel.ts';

const AGENT_HOSTS: Record<string, readonly string[]> = {
  'Claude desktop': [
    '/Applications/Claude.app/Contents/MacOS/Claude',
    '/Users/me/Library/Application Support/Claude/claude-code/2.1.280/claude.app/Contents/MacOS/claude --output-format stream-json --verbose --input-format stream-json',
  ],
  'native claude': ['claude', 'claude --resume', '/Users/me/.local/bin/claude'],
  'npm claude-code': ['node /opt/homebrew/bin/claude', 'node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js --continue'],
  Cursor: [
    '/Applications/Cursor.app/Contents/MacOS/Cursor',
    '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService',
  ],
  'cursor-agent': [
    '/Users/me/Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/bin/cursor-agent --print --output-format stream-json',
    '/Users/me/.local/share/cursor-agent/versions/2025.09.04-fc40cd1/node --use-system-ca /Users/me/.local/share/cursor-agent/versions/2025.09.04-fc40cd1/index.js',
  ],
  codex: [
    '/Applications/ChatGPT.app/Contents/Resources/codex -c features.code_mode_host=true app-server',
    'node /opt/homebrew/bin/codex',
    '/opt/homebrew/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex exec',
  ],
  opencode: ['opencode', '/Users/me/.opencode/bin/opencode serve', 'node /opt/homebrew/lib/node_modules/opencode-ai/bin/opencode'],
  'VS Code': [
    '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper --type=utility --utility-sub-type=node.mojom.NodeService --lang=en-US',
    '/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron',
    '/usr/share/code/code --type=utility --utility-sub-type=node.mojom.NodeService',
    'code-insiders --wait',
  ],
  Warp: ['/Applications/Warp.app/Contents/MacOS/stable', '/opt/warpdotdev/warp-terminal/warp-terminal'],
  Kiro: ['/Applications/Kiro.app/Contents/MacOS/Electron', '/Applications/Kiro.app/Contents/Frameworks/Kiro Helper.app/Contents/MacOS/Kiro Helper --type=utility'],
  Trae: ['/Applications/Trae.app/Contents/MacOS/Electron'],
  'a JetBrains IDE': [
    '/Applications/IntelliJ IDEA.app/Contents/MacOS/idea',
    '/Users/me/Applications/PyCharm Professional Edition.app/Contents/MacOS/pycharm',
    '/Applications/Android Studio.app/Contents/MacOS/studio',
    '/home/me/.local/share/JetBrains/Toolbox/apps/goland/bin/goland',
    '/opt/idea/jbr/bin/java -classpath /opt/idea/lib/app.jar -Didea.vendor.name=JetBrains com.intellij.idea.Main',
    '/opt/android-studio/bin/studio.sh',
  ],
  'Copilot, Cline, Continue': ['node /opt/homebrew/bin/copilot', 'node /opt/homebrew/lib/node_modules/@github/copilot/index.js', 'node /opt/homebrew/bin/cline', 'node /opt/homebrew/bin/cn'],
};

const PERSON_TERMINALS: Record<string, readonly string[]> = {
  'Terminal.app': ['-zsh', 'login -pf me', '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'],
  iTerm2: ['-zsh', '/usr/bin/login -fpl me /Applications/iTerm.app/Contents/MacOS/iTerm2 --launch_shell', '/Applications/iTerm.app/Contents/MacOS/iTerm2'],
  Ghostty: ['/usr/bin/login -flp me /bin/bash --noprofile --norc -c exec -l /bin/zsh', '/Applications/Ghostty.app/Contents/MacOS/ghostty'],
  'a shell chain': ['/bin/zsh -l', 'bash', 'tmux new-session -s work -c /Users/me/code', 'sshd: me@ttys001', '/sbin/launchd'],
  'Construct itself': ['node /Users/me/code/construct/bin/construct.mjs inbox resolve decision-1 approve', 'npm exec construct inbox resolve decision-1 approve'],
};

test('every agent host and agent-capable editor is recognized in its recorded process lines', () => {
  for (const [host, lines] of Object.entries(AGENT_HOSTS)) {
    for (const line of lines) assert.equal(isAgentProcess(line), true, `${host}: ${line}`);
  }
});

test('a plain terminal and shell chain is not taken for an agent host', () => {
  for (const [terminal, lines] of Object.entries(PERSON_TERMINALS)) {
    for (const line of lines) assert.equal(isAgentProcess(line), false, `${terminal}: ${line}`);
  }
});

test('an editor’s integrated terminal is a relay by its environment alone', () => {
  const facts = { interactive: true, agentAncestor: null };
  const relayed: NodeJS.ProcessEnv[] = [
    { TERM_PROGRAM: 'vscode' },
    { TERM_PROGRAM: 'WarpTerminal' },
    { TERM_PROGRAM: 'Kiro' },
    { TERM_PROGRAM: 'Trae' },
    { VSCODE_PID: '4242' },
    { VSCODE_IPC_HOOK_CLI: '/tmp/vscode-ipc.sock' },
    { VSCODE_GIT_IPC_HANDLE: '/tmp/vscode-git.sock' },
    { TERMINAL_EMULATOR: 'JetBrains-JediTerm' },
    { CURSOR_TRACE_ID: 'abc123' },
  ];
  for (const env of relayed) {
    assert.ok(relayMarkerIn(env), JSON.stringify(env));
    assert.equal(channelFor(env, facts), 'relay', JSON.stringify(env));
  }
  for (const env of [{}, { TERM_PROGRAM: 'Apple_Terminal' }, { TERM_PROGRAM: 'iTerm.app' }, { TERM_PROGRAM: 'ghostty' }] as NodeJS.ProcessEnv[]) {
    assert.equal(relayMarkerIn(env), null, JSON.stringify(env));
    assert.equal(channelFor(env, facts), 'tty_cli', JSON.stringify(env));
  }
});

/** A `ps` that answers from a fixed process table: pid -> [ppid, args]. */
function psFrom(table: Record<number, readonly [number, string]>): PsRunner {
  return (args) => {
    const pid = Number(args[args.length - 1]);
    const row = table[pid];
    return row ? { status: 0, stdout: `${String(row[0]).padStart(5)} ${row[1]}\n` } : { status: 1, stdout: '' };
  };
}

test('the ancestor walk finds the agent host above a shell, and nothing above a plain terminal', () => {
  const inEditor = psFrom({ 900: [800, 'node /Users/me/.npm/bin/construct inbox resolve d-1 approve'], 800: [700, '/bin/zsh -il'], 700: [1, '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper --type=utility'], 1: [0, '/sbin/launchd'] });
  assert.match(agentAncestorOf(900, inEditor) ?? '', /Code Helper/);
  const inTerminal = psFrom({ 900: [800, 'node /Users/me/.npm/bin/construct inbox resolve d-1 approve'], 800: [700, '-zsh'], 700: [600, 'login -pf me'], 600: [1, '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'], 1: [0, '/sbin/launchd'] });
  assert.equal(agentAncestorOf(900, inTerminal), null);
  assert.equal(channelFor({}, { interactive: true, agentAncestor: agentAncestorOf(900, inTerminal) }), 'tty_cli');
});

test('when the process tree cannot be read, the answer is relayed, never taken as the person', () => {
  const failures: Record<string, PsRunner> = {
    'ps is missing': () => ({ status: null, stdout: '', error: Object.assign(new Error('spawnSync /bin/ps ENOENT'), { code: 'ENOENT' }) }),
    'ps is refused': () => ({ status: 1, stdout: '' }),
    'ps throws': () => {
      throw new Error('sandbox denied process-exec');
    },
    'ps prints something else': () => ({ status: 0, stdout: 'usage: ps [-AaCcEefhjlMmrSTvwXx]\n' }),
    'a parent disappears mid-walk': psFrom({ 900: [800, 'node construct inbox resolve d-1 approve'], 800: [700, '-zsh'] }),
    'the walk never ends': psFrom({ 900: [901, '-zsh'], 901: [900, '-zsh'] }),
  };
  for (const [why, ps] of Object.entries(failures)) {
    const ancestor = agentAncestorOf(900, ps);
    assert.equal(ancestor, UNREADABLE_ANCESTRY, why);
    assert.equal(channelFor({}, { interactive: true, agentAncestor: ancestor }), 'relay', why);
  }
});

test('the ancestor walk runs /bin/ps itself, whatever PATH says', { skip: !existsSync('/bin/ps') && 'no /bin/ps here' }, () => {
  const previous = process.env.PATH;
  process.env.PATH = '';
  try {
    const self = systemPs(['-o', 'pid=', '-p', String(process.pid)]);
    assert.equal(self.status, 0, self.error?.message);
    assert.equal(Number(self.stdout.trim()), process.pid);
    assert.notEqual(agentAncestorOf(process.pid), UNREADABLE_ANCESTRY);
  } finally {
    process.env.PATH = previous;
  }
});
