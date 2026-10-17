const heroVideo = document.querySelector('.hero-video');
const heroToggle = document.querySelector('.hero-video-toggle');
const signupDialog = document.querySelector('#beta-dialog');
let resumeAfterSignup = false;
let manuallyPaused = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function syncVideoButton() {
  const label = heroVideo.paused ? 'Play video' : 'Pause video';
  heroToggle.setAttribute('aria-label', label);
  heroToggle.title = label;
  heroToggle.dataset.paused = String(heroVideo.paused);
}

function playHeroVideo() {
  if (signupDialog.open || reducedMotion.matches || manuallyPaused) return;
  heroVideo.muted = true;
  heroVideo.play().catch(() => {
    // Autoplay may be blocked; leave the poster and offer manual playback.
    syncVideoButton();
  });
}

function applyMotionPreference() {
  heroToggle.hidden = reducedMotion.matches;
  if (reducedMotion.matches) {
    heroVideo.pause();
    return;
  }
  if (!heroVideo.hasAttribute('src')) {
    heroVideo.src = heroVideo.dataset.src;
  }
  playHeroVideo();
}

heroToggle.addEventListener('click', () => {
  manuallyPaused = !heroVideo.paused;
  if (manuallyPaused) heroVideo.pause();
  else playHeroVideo();
});
// Capture playback before the modal pauses it, so a manual pause stays paused.
new MutationObserver(() => {
  if (signupDialog.open) {
    resumeAfterSignup = !heroVideo.paused;
    heroVideo.pause();
  } else {
    const shouldResume = resumeAfterSignup;
    resumeAfterSignup = false;
    if (shouldResume) playHeroVideo();
  }
}).observe(signupDialog, { attributes: true, attributeFilter: ['open'] });
heroVideo.addEventListener('play', () => {
  if (signupDialog.open) heroVideo.pause();
  syncVideoButton();
});
heroVideo.addEventListener('pause', syncVideoButton);
heroVideo.addEventListener('error', () => {
  heroVideo.hidden = true;
  heroToggle.hidden = true;
});
reducedMotion.addEventListener('change', applyMotionPreference);
applyMotionPreference();
