[![English](https://img.shields.io/badge/English-blue?style=flat&logo=readme&logoColor=white)](README.en.md) [![Lietuvių](https://img.shields.io/badge/Lietuvi%C5%B3-blue?style=flat&logo=readme&logoColor=white)](README.lt.md) [![Все скрипты](https://img.shields.io/badge/%D0%92%D1%81%D0%B5%20%D1%81%D0%BA%D1%80%D0%B8%D0%BF%D1%82%D1%8B-blue?style=flat&logo=readme&logoColor=white)](../../README.md)

# VLK Insured Search

[![Install](https://img.shields.io/badge/Install-Direct-brightgreen)](vlk_insured_search.user.js?raw=1)

Добавляет единое поле "Asmens kodas" в форму поиска застрахованных лиц на сайте VLK.

### Скриншоты
| До (Before) | После (After) |
| :--- | :--- |
| ![Before](https://github.com/DayDve/userscripts/blob/master/screenshots/vlk_before.png?raw=true) | ![After](https://github.com/DayDve/userscripts/blob/master/screenshots/vlk_after.png?raw=true) |

### Функционал
* Добавляет поле для ввода "Asmens kodas" прямо в форму поиска.
* Автоматически парсит дату рождения, пол и последние цифры из введённого личного кода для заполнения оригинальных полей формы.
* Запоминает последнее успешно введённое значение с помощью `sessionStorage`.
* Позволяет легко переключаться между кастомным полем и оригинальной формой.
