const cron = require('node-cron');
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const { PrismaClient } = require('@prisma/client');
const { Telegraf } = require('telegraf');

const prisma = new PrismaClient();
const BOT_TOKEN = '8929164430:AAHA5S6G6R0J06DVbh0mTOSgtegIfPsFFBQ';
const REDIS_URL = 'rediss://default:gQAAAAAAAhfnAAIgcDIzMmQxNGQxNTc5ODk0OTliYjFjMzQyMDg1YmI2MGU3Zg@creative-parrot-137191.upstash.io:6379';

const bot = new Telegraf(BOT_TOKEN);
const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null, family: 4, tls: { rejectUnauthorized: false } });
const monitorQueue = new Queue('monitor-queue', { connection });

// --- 1. РЕГУЛЯРНІ ПЕРЕВІРКИ (кожні 15 хвилин) ---
cron.schedule('* * * * *', async () => {
    const activeSites = await prisma.site.findMany({ where: { isActive: true } });
    for (const site of activeSites) {
        await monitorQueue.add('check-site-auto', {
            targetUrl: site.url,
            clientId: site.clientId,
            siteId: site.id // ПЕРЕДАЄМО ID у Worker!
        });
    }
});

// Звіт вечір
cron.schedule('0 21 * * *', async () => {
    console.log('📊 Генерую вечірні звіти для клієнтів...');

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const sites = await prisma.site.findMany({
        where: { isActive: true },
        include: { logs: { where: { createdAt: { gte: startOfDay } } } } 
    });

    const reportsByClient = {};

    sites.forEach(site => {
        if (site.logs.length === 0) return; 

        const total = site.logs.length;
        const successCount = site.logs.filter(l => l.isSuccess).length;
        const uptime = Math.round((successCount / total) * 100);
        const avgSpeed = Math.round(site.logs.reduce((acc, log) => acc + log.loadTimeMs, 0) / total);

        const icon = uptime === 100 ? '🟢' : (uptime > 90 ? '🟡' : '🔴');

        if (!reportsByClient[site.clientId]) {
            reportsByClient[site.clientId] = '🌙 Вечірній звіт моніторингу\n\nОсь як працювали ваші сайти сьогодні:\n\n';
        }

        reportsByClient[site.clientId] += `${icon} ${site.url}\n`;
        reportsByClient[site.clientId] += `├ Перевірок: ${total}\n`;
        reportsByClient[site.clientId] += `├ Uptime (Доступність): ${uptime}%\n`;
        reportsByClient[site.clientId] += `└ Сер. швидкість: ${avgSpeed} мс\n\n`;
    });

    // Розсилка
    for (const [clientId, text] of Object.entries(reportsByClient)) {
        await bot.telegram.sendMessage(clientId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    }
});

console.log('⏰ Планувальник запущено (Перевірки + Вечірні звіти)');
