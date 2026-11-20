[![Русский](https://img.shields.io/badge/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-blue?style=flat&logo=readme&logoColor=white)](README.md) [![Lietuvių](https://img.shields.io/badge/Lietuvi%C5%B3-blue?style=flat&logo=readme&logoColor=white)](README.lt.md) [![All scripts](https://img.shields.io/badge/All%20scripts-blue?style=flat&logo=readme&logoColor=white)](../../README.en.md)

# LT VIISP -> Swedbank Auto

[![Install](https://img.shields.io/badge/Install-Direct-brightgreen)](lt_viisp.user.js?raw=1)

Automates authentication on Lithuanian government portals. Removes the need to click through multiple bank selection pages.

### Screenshots
| Before | After |
| :--- | :--- |
| ![Before](https://github.com/DayDve/userscripts/blob/master/screenshots/viisp_before.png?raw=true) | ![After](https://github.com/DayDve/userscripts/blob/master/screenshots/viisp_after.png?raw=true) |

### Features
- Adds an "Auth via SB" button: straight to Swedbank, with no system, bank or consent pages to click through. The intermediate pages are passed automatically behind a "logging in" screen.
- The ▾ on the button lists your saved Swedbank IDs. Pick one and the script fills in the bank's login form too: all that is left is confirming the code on your phone.
- The ID, the asmens kodas (when the bank asks for it) and the login method are remembered when you log in to Swedbank by hand. Up to 5 are kept; remove one with the ✕ in the list.
- Supported sites: [Sodra](https://www.sodra.lt), [Migris](https://www.migracija.lt), [Esveikata](https://www.esveikata.lt) (opens the patient portal right away).
