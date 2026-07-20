# TowerForge Brand

TowerForge uses a compact product identity designed for editor chrome, desktop installers, repositories, and game-development documentation.

## Brand idea

The mark combines three product ideas in one readable silhouette:

- the hexagon is the editable game grid;
- the central tower is the object being authored;
- the separated planes and amber spark represent deterministic assembly in a forge.

The identity should feel like a capable developer tool, not a fantasy game logo. Use precise geometry, restrained depth, and compact typography. Avoid medieval crests, flames, mascots, ornamental shields, and neon cyberpunk treatment.

## Names and copy

- Product: **TowerForge**
- Desktop editor: **TowerForge Editor** or **TowerForge Studio**
- Creator: **Lindforge Studios**
- Descriptor: **Game Constructor**
- Primary proposition: **Build tower-defense games. Visually, deterministically, with AI.**

Do not write the product name as `Tower Forge`, `Towerforge`, or `TowerForge Engine` unless referring specifically to the runtime engine package.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Forge Black | `#111111` | Primary dark background |
| Graphite | `#1A1A1A` | Surfaces and icon body |
| Iron | `#E8E8E8` | Primary text and tower silhouette |
| Forge Green | `#7EB87E` | Primary brand accent |
| Blueprint Blue | `#6EA8D8` | Technical construction lines |
| Spark Amber | `#E8A44A` | Small highlights only |

Green is the dominant accent. Blue communicates plans, simulation, and tooling. Amber is limited to a single spark or status highlight.

## Assets

- `assets/brand/towerforge-mark.svg`: primary mark on a built-in dark tile.
- `assets/brand/towerforge-mark-mono.svg`: one-color mark for constrained contexts.
- `assets/brand/towerforge-lockup-dark.svg`: lockup for dark surfaces.
- `assets/brand/towerforge-lockup-light.svg`: lockup for light surfaces.
- `assets/brand/towerforge-readme-banner.png`: Russian repository hero.
- `assets/brand/towerforge-social-preview.png`: Russian GitHub social preview upload.
- `assets/brand/towerforge-readme-banner-en.png`: English repository hero.
- `assets/brand/towerforge-social-preview-en.png`: English social preview.
- `assets/brand/towerforge-app-icon.png`: 1024 px desktop icon source.

Keep clear space around the mark equal to at least one quarter of its width. Do not recolor individual planes, rotate the mark, add effects, place it over noisy imagery, or use the multicolor mark below 24 px. Use the monochrome mark at very small sizes.

## Rebuilding exports

Run `npm run brand:build`. The script composites exact logo and copy over the checked-in hero artwork, then exports the README banner, GitHub social preview, and 1024 px application icon. Run `npm run brand:icons` after changing the application icon source to regenerate the native Windows, macOS, Linux, Android, and iOS icon files.

The hero artwork was generated with OpenAI ImageGen and then combined with deterministic SVG and HTML layers. Image generation must never be used to render the TowerForge name, logo, legal copy, or export dimensions.
