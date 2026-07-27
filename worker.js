const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { Telegraf } = require('telegraf');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const { checkAddToCartAuto } = require('./monitor');

// --- БЕЗПЕЧНІ НАЛАШТУВАННЯ З .ENV ---
const REDIS_URL = process.env.REDIS_URL;
const BOT_TOKEN = process.env.BOT_TOKEN;

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null, family: 4, tls: { rejectUnauthorized: false } });
const bot = new Telegraf(BOT_TOKEN);
const prisma = new PrismaClient();

console.log('👷 Worker успішно запущено. Очікую завдання...');

const worker = new Worker('monitor-queue-v2', async job => {
    const { targetUrl, clientId, siteId } = job.data;
    console.log(`\n🔍 Отримав завдання, передаю в monitor.js: ${targetUrl}`);

    try {
        const result = await checkAddToCartAuto(targetUrl);

        await prisma.monitorLog.create({
            data: {
                siteId: siteId,
                ping: result.metrics.pingMs || 0,
                status: result.metrics.httpStatus || 500,
                loadTimeMs: result.metrics.loadTimeMs || 0,
                isSuccess: result.success
            }
        });

        if (result.success) {
            const targetBtn = result.metrics.newAiCta || 'Не знайдено';

            const auditText = `🟢 <b>Аудит пройдено:</b> ${targetUrl}\n\n` +
                `⚡️ <b>ПРОДУКТИВНІСТЬ</b>\n` +
                `├ Статус: ${result.metrics.httpStatus}\n` +
                `├ Пінг: ${result.metrics.pingMs} мс\n` +
                `├ Завантаження: ${result.metrics.loadTimeMs} мс\n` +
                `└ SSL: ${result.metrics.sslDays ? '✅ ' + result.metrics.sslDays + ' днів' : '❌ Помилка'}\n\n` +
                `🖼 <b>ВІЗУАЛ</b>\n` +
                `├ Биті (404): ${result.metrics.brokenImages === 0 ? '✅ 0' : `❌ ${result.metrics.brokenImages}`}\n` +
                `└ Важкі (>1с): ${result.metrics.slowImages === 0 ? '✅ 0' : `❌ ${result.metrics.slowImages}`}\n\n` +
                `🎯 <b>ВОРОНКА ТА ШІ</b>\n` +
                `├ Ціль: ШІ обрав "${targetBtn}"\n` +
                `├ Кнопка: ${result.metrics.buttonFound ? '✅ Знайдена' : '❌ Не знайдена'}\n` +
                `└ Конверсія: ${result.metrics.conversionWorked ? '✅ Успішно' : '⚠️ Провал/Немає'}`;

            await connection.set(`audit:${siteId}`, auditText, 'EX', 86400 * 3);
            console.log(`✅ Звіт для ${targetUrl} успішно оновлено.`);
        }
        else {
            let safeErrorMsg = result.error
                ? result.error.replace(/\u001b\[\d+m/g, '')
                    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
                : 'Невідома технічна помилка';

            if (safeErrorMsg.length > 600) {
                safeErrorMsg = safeErrorMsg.substring(0, 600) + '... [Текст обрізано]';
            }

            const errorText = `🔴 <b>Помилка моніторингу:</b> ${targetUrl}\n\nДеталі: <i>${safeErrorMsg}</i>`;

            await connection.set(`audit:${siteId}`, errorText, 'EX', 86400 * 3);

            try {
                if (result.screenshotPath) {
                    await bot.telegram.sendPhoto(clientId, { source: result.screenshotPath }, {
                        caption: `🚨 <b>УВАГА! Проблема з сайтом!</b>\n\n${errorText}`,
                        parse_mode: 'HTML'
                    });
                } else {
                    throw new Error('Скріншот відсутній');
                }
            } catch (sendError) {
                console.log(`⚠️ Помилка відправки фото для ${targetUrl}. Перехід на текстове сповіщення. Деталі:`, sendError.message);
                await bot.telegram.sendMessage(clientId, `🚨 <b>УВАГА! Проблема з сайтом (Скріншот недоступний)!</b>\n\n${errorText}`, { parse_mode: 'HTML' });
            }
        }

    } catch (error) {
        console.error(`❌ Фатальна помилка воркера для ${targetUrl}:`, error.message);
        await prisma.monitorLog.create({
            data: { siteId: siteId, ping: 0, status: 500, loadTimeMs: 0, isSuccess: false }
        });
    }
}, { connection });

worker.on('failed', (job, err) => console.log(`⚠️ Завдання завершилось з помилкою: ${err.message}`));