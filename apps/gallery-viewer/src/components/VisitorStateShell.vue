<template>
  <main class="visitor-state">
    <div class="state-brand"><img src="/favicon.svg" width="36" height="36" alt="" /><span>阳光明媚</span></div>
    <section class="state-content"><slot /></section>
  </main>
</template>

<style scoped>
.visitor-state { display: grid; grid-template-rows: auto 1fr; align-items: center; min-height: 100svh; padding: 28px clamp(20px, 5vw, 72px); background: #edf0e7; color: #213a2b; }
.state-brand { display: flex; align-items: center; gap: 12px; font: 400 26px/1.4 var(--font-serif); letter-spacing: .08em; }
.state-brand img { flex: 0 0 auto; }
.state-content { position: relative; width: min(476px, 100%); margin: 40px auto; padding: clamp(24px, 5vw, 48px); background: #fffef8; border-inline-start: 5px solid #41604a; box-shadow: 0 2px 0 #d5dacc, 0 14px 38px -26px #253b2bcc; }
.state-content :deep(.state-icon) { display: inline-flex; color: #31583d; margin-bottom: 24px; }
.state-content :deep(h1) { margin-bottom: 16px; font: 400 clamp(28px, 4vw, 36px)/1.4 var(--font-serif); letter-spacing: .015em; overflow-wrap: anywhere; text-wrap: balance; }
.state-content :deep(.state-description) { color: #626c65; font-size: 14px; line-height: 1.9; }
.state-content :deep(.state-action) { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 48px; margin-top: 28px; padding: 12px 22px; border-radius: 6px; background: #26735d; color: #fffefa; font-size: 14px; font-weight: 500; transition: background .18s; }
.state-content :deep(.state-action:hover:not(:disabled)) { background: #1b5746; }
.state-content :deep(.state-action:disabled) { opacity: .5; }
@media (max-width: 600px) { .visitor-state { padding-top: max(24px, env(safe-area-inset-top)); padding-bottom: max(24px, env(safe-area-inset-bottom)); }.state-brand { font-size: 24px; }.state-content { margin-block: 52px; } }
@media (prefers-reduced-motion: reduce) { .state-content :deep(.state-action) { transition: none; } }
</style>
