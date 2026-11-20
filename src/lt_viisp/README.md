[![English](https://img.shields.io/badge/English-blue?style=flat&logo=readme&logoColor=white)](README.en.md) [![Lietuvių](https://img.shields.io/badge/Lietuvi%C5%B3-blue?style=flat&logo=readme&logoColor=white)](README.lt.md) [![Все скрипты](https://img.shields.io/badge/%D0%92%D1%81%D0%B5%20%D1%81%D0%BA%D1%80%D0%B8%D0%BF%D1%82%D1%8B-blue?style=flat&logo=readme&logoColor=white)](../../README.md)

# LT VIISP -> Swedbank Auto

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
