# ELIT 60-second cinematic trailer

Separate clean Vite + Vanilla JS + Three.js project. No previous explorer code.

## Run

```sh
npm install
npm run download
npm run dev
```

Production:

```sh
npm run build
npm run preview
```

Space or tap restarts. Output is `dist/`.

## 60-second timeline

- 0:00–0:05 four samurai on highest peak, Saurashtra mountain
- 0:05–0:08 one samurai: “What comes next…?”
- 0:08–0:11 booming/bhari aawaz
- 0:11–0:15 Krishna-inspired man enters
- 0:15–0:18 all samurai: “Here is the man.”
- 0:18–0:22 spell activates
- 0:22–0:25 sky opens
- 0:25–0:33 crimson dragon: `JAMNAGAR · DWARKA · KUTCH`
- 0:33–0:41 azure dragon: `JUNAGADH · PORBANDAR · GIR · SOMNATH`
- 0:41–0:49 emerald dragon: `WHOLE SAURASHTRA TOGETHER`
- 0:49–0:54 golden dragon: `WELCOME TO ELIT`
- 0:54–1:00 final title `ELIT — GET TOGETHER`

## Realism scope

This is a live stylized 3D trailer, not a flat 2D edit. It uses WebGL2, PBR `MeshStandardMaterial`, sRGB + ACES, HDR environment generation, `PCFSoftShadowMap`, rigged samurai, high-detail dragon source, cinematic camera, particle VFX, and generated sky text. For literal 9/10 photorealism, render this timeline offline at higher resolution with baked lighting/simulated smoke and production facial/armor assets; this project does not include a Blender render farm. Actual iPad Safari visual/60 FPS verification is required.

## Assets

- CC0 rigged samurai, Grab3D
- CC0 high-detail dragon, Grab3D
- Krishna-inspired character is original, reverent, simplified geometry; no copied religious artwork
- No `girl.glb`

Credit: **Kaushik + AI**. No previous project assets reused.
