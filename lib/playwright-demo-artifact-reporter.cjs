/**
 * lib/playwright-demo-artifact-reporter.cjs — Playwright reporter for demo recording.
 *
 * Writes exact video and screencast attachment paths from test results to a JSON
 * manifest. Construct reads the manifest instead of scanning output directories.
 */

const fs = require('node:fs');
const path = require('node:path');

function isVideoAttachment(attachment) {
  if (!attachment?.path) return false;
  if (attachment.contentType?.startsWith('video/')) return true;
  return /\.(webm|mp4)$/i.test(attachment.path);
}

class ConstructDemoArtifactReporter {
  constructor(options = {}) {
    this.manifestPath = options.manifestPath || process.env.CONSTRUCT_DEMO_ARTIFACT_MANIFEST || '';
    this.recordingMode = options.recordingMode || process.env.CONSTRUCT_DEMO_RECORDING_MODE || 'video';
    this.artifacts = [];
  }

  onTestEnd(_test, result) {
    for (const attachment of result.attachments || []) {
      if (!isVideoAttachment(attachment)) continue;
      this.artifacts.push({
        name: attachment.name,
        path: path.resolve(attachment.path),
        contentType: attachment.contentType || '',
        mode: 'video',
      });
    }
  }

  onEnd() {
    const screencastPath = process.env.CONSTRUCT_DEMO_SCREENCAST_OUTPUT;
    if (screencastPath && fs.existsSync(screencastPath)) {
      this.artifacts.push({
        name: 'screencast',
        path: path.resolve(screencastPath),
        contentType: 'video/webm',
        mode: 'screencast',
      });
    }

    if (!this.manifestPath) return;
    fs.mkdirSync(path.dirname(this.manifestPath), { recursive: true });
    fs.writeFileSync(this.manifestPath, JSON.stringify({
      recordingMode: this.recordingMode,
      artifacts: this.artifacts,
    }, null, 2));
  }
}

module.exports = ConstructDemoArtifactReporter;
