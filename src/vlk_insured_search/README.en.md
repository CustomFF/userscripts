[![Русский](https://img.shields.io/badge/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-blue?style=flat&logo=readme&logoColor=white)](README.md) [![Lietuvių](https://img.shields.io/badge/Lietuvi%C5%B3-blue?style=flat&logo=readme&logoColor=white)](README.lt.md) [![All scripts](https://img.shields.io/badge/All%20scripts-blue?style=flat&logo=readme&logoColor=white)](../../README.en.md)

# VLK Insured Search

[![Install](https://img.shields.io/badge/Install-Direct-brightgreen)](vlk_insured_search.user.js?raw=1)

Adds a single "Asmens kodas" (personal code) field to the search form on the VLK website.

### Screenshots
| Before | After |
| :--- | :--- |
| ![Before](https://github.com/DayDve/userscripts/blob/master/screenshots/vlk_before.png?raw=true) | ![After](https://github.com/DayDve/userscripts/blob/master/screenshots/vlk_after.png?raw=true) |

### Features
* Adds a convenient "Asmens kodas" input field directly into the search form.
* Automatically parses date of birth, gender, and the remaining digits from the personal code to populate the original form fields.
* Remembers the last entered personal code using `sessionStorage`.
* Allows seamless switching between the custom input field and the original search form.
