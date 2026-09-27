'use strict';

// Two scalar weights: action = output-interface scale × internal weight × input.
// Input and target are both 1. Different factorizations represent the same action.
const interfaceRatio = document.getElementById('interface-ratio');
const mergeWeight = document.getElementById('merge-weight');
const labModeButtons = [...document.querySelectorAll('[data-lab-mode]')];
let labMode = 'merge';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function updateInterfaceLab(replay = false) {
  const ratio = Number(interfaceRatio.value);
  const beta = labMode === 'a' ? 0 : labMode === 'b' ? 1 : Number(mergeWeight.value);
  const mergedWeight = 1 - beta + beta / ratio;
  const mergedScale = 1 - beta + beta * ratio;
  const outputs = { specific: labMode === 'merge' ? mergedWeight * mergedScale : 1, shared: 1 };
  document.getElementById('ratio-value').value = ratio.toFixed(2) + '×';
  interfaceRatio.setAttribute('aria-valuetext', `Expert B output scale ${ratio.toFixed(2)} times Expert A`);
  mergeWeight.disabled = labMode !== 'merge';
  document.querySelector('.mixture-control').classList.toggle('is-disabled', mergeWeight.disabled);
  document.getElementById('weight-value').value = `${Math.round((1-beta)*100)} : ${Math.round(beta*100)}`;
  mergeWeight.setAttribute('aria-valuetext', `${Math.round((1-beta)*100)} percent expert A, ${Math.round(beta*100)} percent expert B`);
  document.querySelectorAll('[data-lab-preset]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.labPreset) === ratio)));
  document.getElementById('lab-substitution').value = `≈ ${mergedWeight.toFixed(3)} × ${mergedScale.toFixed(3)} ≈ ${(mergedWeight * mergedScale).toFixed(3)}`;
  const mismatch = outputs.specific > 1.00001;
  document.getElementById('lab-specific').classList.toggle('has-mismatch', mismatch);
  document.getElementById('explanation-specific').textContent = labMode !== 'merge'
    ? 'Internal parameters match this expert’s interface. The action is correct.'
    : mismatch ? 'The merged hidden weight no longer compensates for the output scale.'
    : 'Matching interfaces preserve the target in this example.';
  for (const id of ['specific', 'shared']) {
    document.getElementById(`action-${id}`).textContent = outputs[id].toFixed(3);
    document.getElementById(`error-${id}`).textContent = outputs[id] > 1.00001 ? `+${((outputs[id] - 1) * 100).toFixed(1)}%` : '0.0%';
  }
  labModeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.labMode === labMode)));
  document.getElementById('badge-specific').textContent = mismatch ? 'Off target' : 'On target';
  for (const [id, value] of Object.entries({'factor-b-weight':1/ratio,'factor-b-scale':ratio,'factor-weight':mergedWeight,'factor-scale':mergedScale,'factor-action':outputs.specific})) document.getElementById(id).value = value.toFixed(3);
  document.getElementById('factor-policy').textContent = labMode === 'merge' ? 'Merged' : `Selected ${labMode.toUpperCase()}`;
  updateMixtureChart(ratio, beta);
  window.dispatchEvent(new CustomEvent('policyweave:lab-update', { detail: { ratio, beta, mode: labMode, ...outputs, replay } }));
}

function updateMixtureChart(ratio, beta) {
  const error = b => ((1-b+b/ratio)*(1-b+b*ratio)-1)*100;
  const max = Math.max(20, Math.ceil(error(.5)/20)*20);
  const x = b => 44+370*b;
  const y = b => 140-116*error(b)/max;
  const curve = Array.from({length:101}, (_,i) => `${i?'L':'M'}${x(i/100).toFixed(2)} ${y(i/100).toFixed(2)}`).join(' ');
  document.getElementById('sweep-specific').setAttribute('d',curve);
  document.getElementById('sweep-area').setAttribute('d',`${curve} L414 140 L44 140 Z`);
  document.getElementById('sweep-cursor').setAttribute('d',`M${x(beta)} 24V140`);
  document.getElementById('sweep-dot').setAttribute('cx',x(beta));
  document.getElementById('sweep-dot').setAttribute('cy',y(beta));
  document.getElementById('sweep-shared-dot').setAttribute('cx',x(beta));
  document.getElementById('sweep-max').textContent = `${max}%`;
  document.getElementById('sweep-mid').textContent = `${max/2}%`;
  document.getElementById('sweep-insight').textContent = ratio === 1
    ? 'With matching interfaces, every mixture stays on target in this example.'
    : 'Both endpoints are correct. Mixing incompatible parameters introduces error between them.';
  document.getElementById('mixture-chart-desc').textContent = `Analytical action deviation, not experimental results. At ${Math.round(beta*100)}% expert B: task-specific ${error(beta).toFixed(1)}%, shared 0%.`;
}

interfaceRatio.addEventListener('input', () => updateInterfaceLab());
mergeWeight.addEventListener('input', () => updateInterfaceLab());
document.querySelectorAll('[data-lab-preset]').forEach(button => button.addEventListener('click', () => {
  interfaceRatio.value = button.dataset.labPreset;
  mergeWeight.value = .5;
  labMode = 'merge';
  updateInterfaceLab(true);
}));
document.getElementById('mixture-chart').addEventListener('click', event => {
  const chart = event.currentTarget;
  const point = new DOMPoint(event.clientX,event.clientY).matrixTransform(chart.getScreenCTM().inverse());
  mergeWeight.value = Math.max(0,Math.min(1,(point.x-44)/370));
  labMode = 'merge';
  updateInterfaceLab(true);
});
labModeButtons.forEach(button => button.addEventListener('click', () => {
  labMode = button.dataset.labMode;
  updateInterfaceLab(true);
  document.getElementById('lab-status').textContent = `${button.textContent}: task-specific interface action ${document.getElementById('action-specific').textContent}; shared interface action 1.000. Target is 1.`;
}));
updateInterfaceLab();

const tabs = [...document.querySelectorAll('[role="tab"]')];
function activateTab(tab, moveFocus = false) {
  tabs.forEach(item => {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  });
  if (moveFocus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', event => {
    const keys = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 };
    if (Object.hasOwn(keys, event.key)) {
      event.preventDefault();
      activateTab(tabs[keys[event.key]], true);
    }
  });
});

if ('IntersectionObserver' in window) {
  const navigation = [...document.querySelectorAll('nav a')];
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) navigation.forEach(link => {
        link.classList.toggle('active', link.hash === '#' + entry.target.id);
      });
    });
  }, { rootMargin: '-15% 0px -65% 0px' });
  navigation.forEach(link => { const section = document.querySelector(link.hash); if (section) observer.observe(section); });
}

// The four unedited local demonstrations share one featured video player.
const heroVideo = document.getElementById('hero-video');
const heroPlay = document.getElementById('hero-play');
const videoStatus = document.getElementById('video-status');
const heroTasks = [...document.querySelectorAll('[data-hero-task]')];
const taskNames = { 'upright-bottle': 'upright bottle', 'stack-blocks': 'stack blocks', 'press-button': 'press button', 'place-cup': 'place cup' };
async function playHero() {
  try {
    await heroVideo.play();
  } catch {
    heroVideo.controls = true;
    videoStatus.textContent = 'Use the video controls to start the featured demonstration.';
  }
}
heroPlay.addEventListener('click', playHero);
heroVideo.addEventListener('error', () => { videoStatus.textContent = 'The demonstration could not load. Select a task to retry.'; });
heroVideo.addEventListener('play', () => { heroPlay.hidden = true; heroVideo.controls = true; });
heroVideo.addEventListener('pause', () => { heroPlay.hidden = false; });
heroTasks.forEach(button => button.addEventListener('click', () => {
  const task = button.dataset.heroTask;
  heroVideo.pause();
  heroVideo.poster = `assets/images/${task}.jpg`;
  heroVideo.src = `assets/videos/${task}.mp4`;
  heroVideo.querySelector('a').href = heroVideo.src;
  heroVideo.querySelector('a').textContent = `Download ${taskNames[task]} demonstration`;
  videoStatus.textContent = '';
  heroVideo.setAttribute('aria-label', `Selected successful PolicyWeave rollout: ${taskNames[task]}`);
  document.getElementById('featured-task-title').textContent = taskNames[task][0].toUpperCase() + taskNames[task].slice(1);
  heroTasks.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  playHero();
}));
document.addEventListener('visibilitychange', () => { if (document.hidden) heroVideo.pause(); });
document.querySelectorAll('[data-result-link]').forEach(link => link.addEventListener('click', () => activateTab(document.getElementById(`tab-${link.dataset.resultLink}`))));
