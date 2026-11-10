# Whose Chat

משחק ניחוש: רואים צ'אט של טוויץ' ומנחשים של איזה סטרימר הוא.
האתר רץ בחינם על GitHub Pages, ומערכת האיסוף רצה פעם ביום ב-GitHub Actions ושומרת קליפים חדשים עם הצ'אט שלהם.

## מה יש בתיקייה

| קובץ / תיקייה | מה זה |
|---|---|
| `index.html` | כל המשחק בקובץ HTML אחד: העיצוב, הקוד, ההגדרות, וצ'אט לדוגמה לבדיקה (המשחק משתמש בו רק כל עוד אין קליפים אמיתיים) |
| `collector/collect.mjs` | מערכת האיסוף: מוצאת קליפים, מושכת את הצ'אט ושומרת |
| `collector/config.json` | רשימת הסטרימרים והגדרות האיסוף |
| `.github/workflows/collect.yml` | ההוראה ל-GitHub להריץ את האיסוף כל יום |
| `data/` | המאגר: `index.json` (רשימת הקליפים), `streamers.json`, ותיקיית `clips/` עם קובץ לכל קליפ |

## הפעלה ראשונה (פעם אחת, בערך 15 דקות)

### 1. אפליקציה בטוויץ'
1. נכנסים ל-[dev.twitch.tv/console](https://dev.twitch.tv/console) ומתחברים (צריך אימות דו-שלבי בחשבון טוויץ').
2. **Register Your Application**:
   - Name: כל שם, למשל `whose-chat-yourname`
   - OAuth Redirect URLs: `http://localhost`
   - Category: `Website Integration`
   - Client Type: `Confidential`
3. אחרי היצירה לוחצים **Manage**, מעתיקים את ה-**Client ID**, ולוחצים **New Secret** כדי לקבל **Client Secret**.
   את ה-Secret לא שולחים לאף אחד ולא מדביקים בקבצים. הוא נכנס רק להגדרות ב-GitHub (שלב 3).

### 2. מאגר ב-GitHub
1. יוצרים מאגר חדש (New repository), **Public**, למשל בשם `whose-chat`.
2. בעמוד המאגר: **Add file → Upload files**, וגוררים את **כל התוכן** של התיקייה (כולל התיקייה `.github` והקובץ `.nojekyll`). לוחצים **Commit changes**.
   ב-Windows, אם לא רואים את `.nojekyll`, הוא קובץ ריק ואפשר ליצור אותו ב-GitHub: **Add file → Create new file**, בשם `.nojekyll`.

### 3. המפתחות של טוויץ'
במאגר: **Settings → Secrets and variables → Actions → New repository secret**, ויוצרים שניים:
- `TWITCH_CLIENT_ID` עם ה-Client ID
- `TWITCH_CLIENT_SECRET` עם ה-Client Secret

### 4. הריצה הראשונה
1. **Actions** → בוחרים **Collect clips** → **Run workflow**.
2. זה לוקח כמה דקות. בסוף יש בעמוד הריצה טבלה: כמה קליפים נמצאו ונוספו לכל סטרימר.
3. בריצה הראשונה כל סטרימר מקבל עד 20 קליפים. מכאן כל יום נוספים עד 5 חדשים לכל אחד.

אם הריצה נכשלה בשלב השמירה (Permission denied): **Settings → Actions → General → Workflow permissions → Read and write permissions → Save**, ומריצים שוב.

### 5. להעלות את האתר
**Settings → Pages → Build and deployment**:
- Source: `Deploy from a branch`
- Branch: `main` ותיקייה `/ (root)` → **Save**

אחרי דקה-שתיים האתר זמין בכתובת `https://<שם-המשתמש>.github.io/whose-chat/`.
הקליפים מטוויץ' מתנגנים רק מהכתובת הזו (או מ-localhost), כי טוויץ' מאשר הטמעה רק לפי שם האתר.

## מה קורה כל יום

- האיסוף רץ אוטומטית כל יום בסביבות 06:17 (שעון ישראל) ומוסיף קליפים חדשים מ-60 הימים האחרונים.
- הצ'אט של כל קליפ נשמר בקובץ משלו ב-`data/clips/`, ונשאר שם גם אחרי שטוויץ' מוחק את ה-VOD.
- קליפ שהסטרימר מחק בטוויץ' יוצא מהמאגר אוטומטית, כי הווידאו שלו כבר לא יעבוד.
- אם ריצה נכשלת, GitHub שולח מייל. המשחק ממשיך לעבוד עם כל מה שכבר נאסף.

## שינויים נפוצים

**להוסיף או להוריד סטרימר:** עורכים את `streamers` ב-`collector/config.json`. כותבים את שם המשתמש בטוויץ' כמו שהוא מופיע בכתובת הערוץ, באותיות קטנות (למשל `caseoh_`, `joe_bartolozzi`). סטרימר חדש מקבל את הקליפים שלו בריצה הבאה.

**ניקוד וזמנים:** ב-`index.html`, בחלק שמתחיל ב-`Game settings` (חיפוש `GAME_CONFIG` בעורך טקסט מוצא אותו):
- `revealSeconds`: כמה שניות צ'אט רואים בהתחלה ואחרי כל Skip. ברירת מחדל `[5, 10, 15, 20, 30]`.
- `points`: ניקוד לפי מספר הסקיפים. ברירת מחדל `[1000, 800, 600, 400, 200]`.
- `wrongPoints`: ניקוד לניחוש שגוי.
- `resultClipSeconds`: כמה שניות הקליפ והצ'אט מתנגנים בחלון התוצאה.
- `clipChatDelayMs`: אם בחלון התוצאה הצ'אט מקדים את הווידאו, מגדילים. אם הוא מאחר, מקטינים.

**הגדרות האיסוף:** ב-`collector/config.json`:

| שדה | מה הוא עושה |
|---|---|
| `lookbackDays` | כמה ימים אחורה מחפשים קליפים (60, כי אז טוויץ' מוחק את ה-VOD) |
| `minViews` | מינימום צפיות לקליפ |
| `startingClipsPerStreamer` | כמה קליפים סטרימר מקבל בריצה הראשונה שלו |
| `newClipsPerStreamerPerRun` | כמה קליפים חדשים לכל סטרימר בכל ריצה יומית |
| `maxClipsPerStreamer` | תקרה לכל סטרימר. מעבר לה יוצאים הקליפים עם הכי מעט צפיות |
| `chatSeconds` | כמה שניות צ'אט שומרים מכל קליפ |
| `minMessages`, `minMessagesInFirst5Seconds` | קליפ עם צ'אט שקט מזה לא נכנס למשחק |
| `ignoreUsers` | בוטים שההודעות שלהם לא נשמרות (Nightbot וכו') |

## להריץ על המחשב

**לראות את המשחק:** פתיחה כפולה על `index.html` מריצה אותו עם הצ'אט לדוגמה.
כדי לראות את הקליפים האמיתיים מקומית צריך שרת קטן. בתיקייה של הפרויקט, ב-PowerShell:
```
python -m http.server 8000
```
ואז פותחים `http://localhost:8000`.

**לבדוק צ'אט של קליפ אחד** (צריך [Node.js](https://nodejs.org) גרסה 18 ומעלה):
```
$env:TWITCH_CLIENT_ID="..."
$env:TWITCH_CLIENT_SECRET="..."
node collector/collect.mjs --test=https://clips.twitch.tv/<שם-הקליפ>
```
זה מדפיס את 15 ההודעות הראשונות של הקליפ ולא שומר כלום. אפשר גם `--dry` (ריצה מלאה בלי לשמור) ו-`--only=xqc` (סטרימר אחד).

## אם האיסוף מפסיק לעבוד

טוויץ' לא מציעה דרך רשמית לקרוא צ'אט של VOD, אז המערכת משתמשת באותו ממשק שהאתר של טוויץ' משתמש בו כדי להציג Chat Replay. אם טוויץ' תשנה אותו, הריצה תיכשל עם הודעה שמתחילה ב-`Twitch chat replay`.
מה שכבר נשמר לא נפגע, והמשחק ממשיך לעבוד. התיקון בדרך כלל קטן, בקובץ `collector/collect.mjs`. אפשר גם לעדכן את הערכים בלי לגעת בקוד, דרך הסודות `TWITCH_GQL_CLIENT_ID` ו-`TWITCH_GQL_COMMENTS_HASH` שהקוד קורא אם הם קיימים.
