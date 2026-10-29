# CampusConnect presentation provenance

Source root: local-only `campusconnect-reference/frontend/src/`. These are selectively reused presentation sources, not MedDecode service contracts. No source reference was modified.

| Reference source | Reuse | SHA-256 of reference snapshot |
| --- | --- | --- |
| `components/ui.tsx` | Selected Button, Badge, Card, EmptyState, PageHeader, SectionHeader and Skeleton functions; safe button type added. | `dac9a4ecc7772e49fddd43a1110bcc5ee04429cca9d0eddf3635870c8b0dc152` |
| `components/Icon.tsx` | SVG Icon implementation copied unchanged. | `92b95d4954e20c4f358347a4e65905ac768e2bc82c5eb8fcc888166b0c3d2c71` |
| `components/class-names.ts` | Existing MedDecode class-name helper retained; no duplicate helper imported. | `85017b982736b4ab3f7c59d2becc3a397465228d1df1fb4101eac1a89040943f` |
| `features/theme/ThemeControl.tsx` | Markup/options copied; imports point to MedDecode theme context. | `6c6862ce007712ff94049c4ab78739ff528728c116d4e4aaddbf3a4228e7b698` |
| `app/AppShell.tsx` | ExploreSheet structure, focus containment/restoration, scroll locking and navigation markup adapted; auth/admin/search/notification services excluded. | `66ebea2db93fc19db9813b8c70594f31ba7bc20e42044b8c9e0b8b3a18f8aef1` |
| `app/app-navigation.ts` | Navigation-item concept reused; exactly seven MedDecode destinations replace campus routes. | `d58f4d36661d808b096aa6a48160a97ada8baac1c19980095e47eab09c95f403` |
| `app/app-shell.css` | Selected header/brand/drawer/mobile rules and motion; desktop sidebar and breakpoints deliberately adapted. | `5ca1ef05b20c4cb38a3ac1bd640f431223c719feeb00bc0acc230cc31a0f7cd5` |
| `index.css` | Base geometry/status tokens and selected primitive rules; application palette overrides win; only one Tailwind import retained. | `3e99c845d56d001f5dda2352b5af0e52b491b16ece5ae386dbc4b970ec5944ee` |
| `assets/fonts/manrope-latin-wght-normal.woff2` | Bundled Manrope font copied unchanged. Inter font not copied. | `a30ddcd349703aff7464c34bef3fffdff405ee50c113440d7c8693c02d210972` |
| `assets/fonts/OFL.txt` | Supplied Manrope SIL OFL notice retained alongside font; trailing whitespace normalized. | `58172e0c0fac2cda8a37b348164bb55e44b0e69051e557e92b1d3f6910141f7b` |

## Selection and intentional differences

- Application palette: `app-shell.css` original lines 1-56 override the older base palette. Base radii, shadows, spacing and semantic statuses come from `index.css` lines 19-113.
- Shared CSS selection includes card, button, badge, page/section headers, empty state, icon box, skeleton, theme control, focus and skip-link rules, retaining applicable media queries. Unneeded components such as modal/tabs/toast are not imported.
- Scoped shell CSS uses the original header/brand/Explore/mobile patterns. Four mobile entries replace the original six.
- Desktop navigation becomes a persistent sidebar at 1200 CSS px. Between 768 and 1199 px, Explore opens the drawer. Below 768 px, Home/Upload/Cabinet/More provides navigation.
- Body font uses system fallbacks because the copied Inter font has unresolved notice provenance. Display typography uses licensed Manrope.
- The original compact theme control is enlarged to 44px minimum targets. Light empty-state copy uses the existing muted token rather than the source subtle token to meet the tested normal-text contrast threshold.
- Existing MedDecode provider, storage key, Query provider, API transport and proxy remain authoritative. Theme-color metadata is aligned with the adopted canvas.
- New sidebar/route placeholders contain no accounts, medical records, feature services or invented application endpoints.
- Source CSS, authentication providers, business workflows, API wrappers, sockets, environment values, generated bundles and reference tests were not copied wholesale.

The original source does not supply an Inter-specific notice in its font folder. No Inter binary is redistributed. Manrope notice: `src/assets/fonts/OFL.txt`. Screenshots remain ignored local evidence; visual owner approval is still required.
