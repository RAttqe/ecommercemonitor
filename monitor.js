const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Ініціалізуємо ШІ (Вставте сюди ваш ключ!)
const genAI = new GoogleGenerativeAI("AQ.Ab8RN6KXoqhrmNw81YHj_SrxYtsLhWKP46hpZAc5NUCN3qNg7g");

function getPurePing(targetUrl) {
    return new Promise((resolve) => {
        const start = performance.now();
        try {
            const parsedUrl = new URL(targetUrl);
            const port = parsedUrl.protocol === 'https:' ? 443 : 80;
            const socket = new net.Socket();

            socket.setTimeout(5000);
            socket.on('connect', () => {
                const ping = Math.round(performance.now() - start);
                socket.destroy();
                resolve(ping);
            });
            socket.on('error', () => resolve(0));
            socket.on('timeout', () => { socket.destroy(); resolve(0); });
            socket.connect(port, parsedUrl.hostname);
        } catch(e) { resolve(0); }
    });
}

function getSSLInfo(targetUrl) {
    return new Promise((resolve) => {
        try {
            const parsedUrl = new URL(targetUrl);
            if (parsedUrl.protocol !== 'https:') return resolve(null);

            const socket = tls.connect(443, parsedUrl.hostname, { servername: parsedUrl.hostname, rejectUnauthorized: false }, () => {
                const cert = socket.getPeerCertificate();
                socket.destroy();
                if (cert && cert.valid_to) {
                    const validTo = new Date(cert.valid_to);
                    resolve(Math.floor((validTo - new Date()) / (1000 * 60 * 60 * 24)));
                } else resolve(null);
            });
            socket.on('error', () => resolve(null));
            socket.on('timeout', () => { socket.destroy(); resolve(null); });
        } catch(e) { resolve(null); }
    });
}

// НОВЕ: Передаємо cachedCta сюди
async function checkAddToCartAuto(targetUrl, cachedCta = null) {
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    const result = {
        success: false,
        timestamp: new Date().toISOString(),
        error: null,
        screenshotPath: null,
        metrics: {
            httpStatus: null, pingMs: 0, loadTimeMs: 0, sslDays: null,
            totalImages: 0, brokenImages: 0, slowImages: 0,
            buttonFound: false, conversionWorked: false, checkType: 'Basic',
            newAiCta: null // Сюди запишемо кнопку, якщо її знайшов ШІ
        }
    };

    try {
        result.metrics.pingMs = await getPurePing(targetUrl);
        result.metrics.sslDays = await getSSLInfo(targetUrl);

        const startTime = performance.now();
        console.log(`[1] Заходимо на сайт: ${targetUrl}`);
        const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);

        result.metrics.loadTimeMs = Math.round(performance.now() - startTime);

        if (response) result.metrics.httpStatus = response.status();
        else if (result.metrics.pingMs === 0) throw new Error('Сайт фізично недоступний.');

        if (result.metrics.httpStatus === 403) throw new Error('Cloudflare заблокував доступ (Помилка 403).');
        if (result.metrics.httpStatus >= 400) throw new Error(`Помилка сервера: ${result.metrics.httpStatus}`);

        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(3000);

        console.log(`[2] Проводжу візуальний аналіз...`);
        const imagePerformance = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img'));
            const validImgs = [];
            for (let img of imgs) {
                const src = img.currentSrc || img.src;
                if (!src || src.startsWith('data:') || src.includes('.svg')) continue;
                const isBroken = img.complete && img.naturalWidth === 0;
                const entry = performance.getEntriesByName(src)[0];
                validImgs.push({ isBroken: isBroken, duration: entry ? entry.duration : 0 });
            }
            return validImgs;
        });

        result.metrics.totalImages = imagePerformance.length;
        result.metrics.brokenImages = imagePerformance.filter(img => img.isBroken).length;
        result.metrics.slowImages = imagePerformance.filter(img => !img.isBroken && img.duration > 1000).length;

        // --- МАГІЯ ШІ ПОЧИНАЄТЬСЯ ТУТ ---
        let targetText = cachedCta;

        if (!targetText) {
            console.log(`[3] Кнопка невідома. Збираю дані для ШІ...`);
            const candidates = await page.evaluate(() => {
                const elements = document.querySelectorAll('button, a, input[type="submit"], [role="button"]');
                const list = [];
                elements.forEach((el) => {
                    const text = el.innerText?.trim() || el.value?.trim() || '';
                    // Беремо тільки кнопки з текстом, які видно на екрані
                    if (text.length > 2 && text.length < 30 && el.offsetWidth > 0) {
                        list.push(text);
                    }
                });
                return [...new Set(list)]; // Тільки унікальні
            });

            try {
                // Використовуємо точну назву найстабільнішої моделі: gemini-1.0-pro
                const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

                const aiPromptText = `Ти QA інженер. Знайди головну Call-to-Action кнопку (купити, реєстрація, спробувати, кошик, зв'язок) у цьому списку: ${JSON.stringify(candidates)}. Поверни ТІЛЬКИ точний текст цієї кнопки. Жодних пояснень чи лапок.`;

                const aiResponse = await model.generateContent(aiPromptText);
                targetText = aiResponse.response.text().trim();
                console.log(`✅ ШІ обрав кнопку: "${targetText}"`);

                result.metrics.newAiCta = targetText;
            } catch (e) {
                console.log(`❌ Помилка ШІ:`, e.message);
            }
        } else {
            console.log(`⚡ Використовую кнопку з кешу: "${targetText}"`);
        }

        // --- УНІВЕРСАЛЬНИЙ КЛІК ТА ПЕРЕВІРКА ВОРОНКИ ---
        if (targetText) {
            console.log(`[4] Шукаю кнопку "${targetText}" на сторінці...`);
            // Шукаємо кнопку, що містить текст, і беремо першу видиму
            const ctaButton = page.getByText(targetText, { exact: false }).first();

            if (await ctaButton.isVisible()) {
                result.metrics.buttonFound = true;
                result.metrics.checkType = `E2E (ШІ Кнопка: ${targetText})`;

                const urlBeforeClick = page.url();
                await ctaButton.click({ force: true });
                await page.waitForTimeout(4000);

                const urlAfterClick = page.url();
                // Рахуємо форми на сторінці (для сайтів-візиток і SaaS)
                const formsAppeared = await page.locator('input[type="text"], input[type="email"], form, [role="dialog"]').count();

                // Якщо URL змінився, АБО з'явилася форма/попап, АБО кошик
                if (urlAfterClick !== urlBeforeClick || formsAppeared > 0 || urlAfterClick.includes('cart') || urlAfterClick.includes('checkout')) {
                    result.metrics.conversionWorked = true;
                } else {
                    // Якщо нічого не змінилося — перевіряємо, чи немає критичної системної помилки (як ми робили для Velomaximum)
                    const errorText = page.getByText(/(помилка відправки|сталася помилка|не вдалося|сервер не відповідає)/i);
                    for (let i = 0; i < await errorText.count(); i++) {
                        if (await errorText.nth(i).isVisible()) {
                            throw new Error('Кнопка натиснулась, але сайт видав системну помилку.');
                        }
                    }
                }
            } else {
                result.metrics.checkType = 'Basic (Головна сторінка)';
            }
        } else {
            result.metrics.checkType = 'Basic (Немає кнопок)';
        }

        result.success = true;

    } catch (error) {
        console.error('❌ Помилка:', error.message);
        const screenshotsDir = path.join(__dirname, 'screenshots');
        if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);
        const fileName = `error-${Date.now()}.png`;
        result.screenshotPath = path.join('screenshots', fileName);

        await page.waitForTimeout(2000);
        // 1. Робимо скріншот
        await page.screenshot({ path: result.screenshotPath, fullPage: true });

        // 2. Базова помилка
        result.error = error.message;

        // 3. РОЗУМНИЙ ФІЛЬТР: Не викликаємо ШІ, якщо сайт взагалі не існує (білий екран)
        if (error.message.includes('фізично недоступний')) {
            console.log('⚪ Екран білий (Сайт не існує). ШІ не викликаємо.');
        } else {
            // --- МАГІЯ ШІ: АНАЛІЗ СКРІНШОТУ ПОМИЛКИ ---
            try {
                console.log(`🤖 Прошу ШІ проаналізувати скріншот помилки...`);

                // ВАЖЛИВО: Впишіть сюди ту саму модель, яка успішно запрацювала для пошуку кнопок!
// МАЄ БУТИ ТАК:
                const visionModel = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });
                const imageData = fs.readFileSync(result.screenshotPath);
                const imageBase64 = imageData.toString("base64");

                const prompt = "Ти QA-тестувальник. Це скріншот сторінки інтернет-магазину або сервісу, на якій щойно сталася помилка. Коротко (в 1-2 реченнях) опиши, що ти бачиш на екрані. Чи є там текст системної помилки, банер Cloudflare, білий екран чи щось очевидно поламане?";

                const response = await visionModel.generateContent([
                    prompt,
                    { inlineData: { data: imageBase64, mimeType: "image/png" } }
                ]);

                const aiAnalysis = response.response.text().trim();
                console.log(`👁️ Висновок ШІ: ${aiAnalysis}`);

                result.error = `${error.message}\n\n👁️ <b>Висновок ШІ:</b> ${aiAnalysis}`;

            } catch (aiError) {
                console.log(`❌ Не вдалося проаналізувати скріншот:`, aiError.message);
            }
        }

    } finally {
        await browser.close();
    }
    return result;
}

module.exports = { checkAddToCartAuto };