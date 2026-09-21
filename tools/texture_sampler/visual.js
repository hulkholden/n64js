import { createHarness, nativeWidth, nativeHeight, scales, scenes } from './scenes.js';

// Allow only a one-byte channel rounding difference. Every pixel beyond this
// tolerance fails; do not hide geometry changes behind a percentage allowance.
const tolerance = 1;
const status = document.getElementById('status');

function imageCanvas(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(image, 0, 0);
  return canvas;
}

async function loadGolden(key, width, height) {
  const response = await fetch(`texture_sampler/goldens/${key}.png`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Golden unavailable (${response.status}). Capture and review a baseline first.`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
  try {
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new Error(`Golden dimensions ${bitmap.width} × ${bitmap.height}; expected ${width} × ${height}.`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}

function compare(actual, golden) {
  const difference = new ImageData(actual.width, actual.height);
  let changedPixels = 0;
  let maxDifference = 0;
  for (let offset = 0; offset < actual.data.length; offset += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel++) {
      delta = Math.max(delta, Math.abs(actual.data[offset + channel] - golden.data[offset + channel]));
    }
    maxDifference = Math.max(maxDifference, delta);
    if (delta > tolerance) {
      changedPixels++;
      difference.data[offset] = 255;
      difference.data[offset + 1] = Math.min(255, delta * 4);
      difference.data[offset + 2] = 80;
    }
    difference.data[offset + 3] = 255;
  }
  return { changedPixels, maxDifference, difference };
}

try {
  const harness = createHarness(document.getElementById('display'));

  async function render({ id, scale, frame = 0, capture = false }) {
    const scene = scenes.find(scene => scene.id === id);
    if (!scene || !scales.includes(scale) || !Number.isInteger(frame) || frame < 0 || frame >= (scene.frames || 1)) {
      throw new Error(`Invalid scene selection: ${id}/${scale}/${frame}`);
    }
    const actual = harness.render(scene, scale, frame);
    const key = `${id}-${scale}x-f${frame}`;
    const result = {
      key, id, scale, frame, width: actual.width, height: actual.height,
      actual: imageCanvas(actual).toDataURL('image/png'),
    };
    if (capture) return result;
    try {
      const golden = await loadGolden(key, actual.width, actual.height);
      const { changedPixels, maxDifference, difference } = compare(actual, golden);
      Object.assign(result, {
        passed: changedPixels === 0, changedPixels, maxDifference,
        golden: imageCanvas(golden).toDataURL('image/png'),
        difference: imageCanvas(difference).toDataURL('image/png'),
      });
    } catch (error) {
      result.passed = false;
      result.error = error.message;
    }
    return result;
  }

  const cases = scenes.flatMap(scene => scales.flatMap(scale =>
    Array.from({ length: scene.frames || 1 }, (_, frame) => ({ id: scene.id, scale, frame }))));
  window.samplerVisualTests = { cases, environment: { ...harness.environment, tolerance }, render };

  const container = document.getElementById('scenes');
  const controls = [...document.querySelectorAll('button, select')];
  async function showGallery() {
    controls.forEach(control => control.disabled = true);
    const scale = Number(document.getElementById('scale').value);
    const frame = Number(document.getElementById('frame').value);
    status.textContent = 'Rendering comparisons…';
    container.replaceChildren();
    let passed = 0;
    try {
      for (const scene of scenes) {
        const result = await render({ id: scene.id, scale, frame: scene.frames ? frame : 0 });
        const section = document.createElement('section');
        const title = document.createElement('h2');
        title.textContent = scene.title;
        const description = document.createElement('p');
        description.textContent = scene.description;
        const comparison = document.createElement('div');
        comparison.className = 'comparison';
        for (const [label, url] of [['Live', result.actual], ['Golden', result.golden], ['Difference', result.difference]]) {
          const figure = document.createElement('figure');
          const caption = document.createElement('figcaption');
          caption.textContent = label;
          const image = document.createElement('img');
          image.alt = `${scene.title} — ${label.toLowerCase()}`;
          image.width = result.width;
          image.height = result.height;
          if (url) image.src = url;
          figure.append(caption, image);
          comparison.append(figure);
        }
        const summary = document.createElement('p');
        summary.className = `result ${result.passed ? 'pass' : 'fail'}`;
        summary.textContent = result.error || `${result.passed ? 'MATCH' : 'CHANGED'} · ${result.changedPixels} changed pixels · max channel difference ${result.maxDifference} · ${result.key}`;
        section.append(title, description, comparison, summary);
        container.append(section);
        if (result.passed) passed++;
      }
      status.textContent = `${passed} / ${scenes.length} match · framebuffer ${nativeWidth * scale} × ${nativeHeight * scale} · images enlarged to fit this page`;
      document.title = `${passed}/${scenes.length} match · Texture sampler`;
    } catch (error) {
      status.textContent = `FAIL: ${error.message}`;
      document.title = 'FAIL · Texture sampler';
    } finally {
      controls.forEach(control => control.disabled = false);
    }
  }

  // The automated runner calls render() for every case, without drawing the UI.
  if (!new URLSearchParams(location.search).has('headless')) {
    const manifest = await fetch('texture_sampler/goldens/manifest.json', { cache: 'no-store' });
    const baseline = manifest.ok ? await manifest.json() : { error: 'No captured baseline' };
    document.getElementById('environment').textContent = JSON.stringify({ current: window.samplerVisualTests.environment, baseline }, null, 2);
    document.getElementById('scale').addEventListener('change', showGallery);
    document.getElementById('frame').addEventListener('change', showGallery);
    document.getElementById('render').addEventListener('click', showGallery);
    await showGallery();
  }
} catch (error) {
  status.textContent = `FAIL: ${error.stack || error}`;
  document.title = 'FAIL · Texture sampler';
}
