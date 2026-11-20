# LT VIISP -> Swedbank Auto
[![RU](https://img.shields.io/badge/lang-RU-lightgrey)](README.md) [![EN](https://img.shields.io/badge/lang-EN-blue)](#) [![LT](https://img.shields.io/badge/lang-LT-lightgrey)](README.lt.md) [![Back](https://img.shields.io/badge/Back-List-black)](../../README.en.md)

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
