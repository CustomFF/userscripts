# LT VIISP -> Swedbank Auto
[![RU](https://img.shields.io/badge/lang-RU-blue)](#) [![EN](https://img.shields.io/badge/lang-EN-lightgrey)](README.en.md) [![LT](https://img.shields.io/badge/lang-LT-lightgrey)](README.lt.md) [![Back](https://img.shields.io/badge/Back-List-black)](../../README.md)

[![Install](https://img.shields.io/badge/Install-Direct-brightgreen)](lt_viisp.user.js?raw=1)

Автоматизация авторизации на госпорталах Литвы. Избавляет от необходимости прокликивать кучу страниц выбора банка.

### Скриншоты
| До (Before) | После (After) |
| :--- | :--- |
| ![Before](https://github.com/DayDve/userscripts/blob/master/screenshots/viisp_before.png?raw=true) | ![After](https://github.com/DayDve/userscripts/blob/master/screenshots/viisp_after.png?raw=true) |

### Функционал
* Добавляет кнопку "Auth via SB": вход через Swedbank сразу, без выбора системы, банка и страниц согласия. Промежуточные страницы проходятся автоматически под заглушкой.
* Стрелка ▾ на кнопке открывает список сохранённых Swedbank ID. Выбрал ID, и скрипт сам заполняет форму банка: остаётся только подтвердить код на телефоне.
* ID, asmens kodas (если банк его спрашивает) и способ входа запоминаются, когда входишь в Swedbank вручную. Хранятся до 5 записей, лишние удаляются крестиком в списке.
* Работает на: [Sodra](https://www.sodra.lt), [Migris](https://www.migracija.lt), [Esveikata](https://www.esveikata.lt) (сразу открывает портал пациента).
