const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');
const { Queue } = require('bullmq');
const Redis = require('ioredis');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const REDIS_URL = process.env.REDIS_URL;
const ADMIN_ID = process.env.ADMIN_ID;

const prisma = new PrismaClient();
const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null, family: 4, tls: { rejectUnauthorized: false } });
const monitorQueue = new Queue('monitor-queue-v2', { connection });
// (RATE LIMITING)
const rateLimit = require('telegraf-ratelimit');
bot.use(rateLimit({
    window: 1000, 
    limit: 1,     
    onLimitExceeded: (ctx, next) => {
       
        ctx.reply('⚠️ Занадто швидко! Будь ласка, зачекайте секунду перед наступною дією.');
    }
}));

bot.command('admin', async (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) return;

    try {
        const allUsers = await prisma.user.findMany({
            include: { _count: { select: { sites: true } } }
        });
        const totalUsers = await prisma.user.count();
        const premiumUsers = await prisma.user.count({ where: { isPremium: true } });
        const totalSites = await prisma.site.count();
        const activeSites = await prisma.site.count({ where: { isActive: true } });

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const checksToday = await prisma.monitorLog.count({
            where: { createdAt: { gte: startOfDay } }
        });

        let adminText = `👑 <b>Панель Адміністратора</b>\n\n` +
            `👥 <b>Користувачі:</b> ${totalUsers} (PRO: ${premiumUsers})\n` +
            `🔗 <b>Сайти:</b> ${totalSites} (Активні: ${activeSites})\n` +
            `⚡️ <b>Перевірок сьогодні:</b> ${checksToday}\n\n` +
            `<i>Система працює стабільно.</i>\n\n`;

        allUsers.slice(-15).forEach((u, index) => {
            const identifier = u.username || u.firstName || `ID: ${u.id}`;
            const plan = u.isPremium ? '💎 PRO' : '🎁 Trial';
            adminText += `${index + 1}. ${identifier} [${plan}] — Сайтiв: ${u._count.sites}\n`;
        });

        await ctx.reply(adminText, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('🔴 ДЕТАЛІ ПОМИЛКИ АДМІНКИ:', error);
        ctx.reply('❌ Помилка збору статистики.');
    }
});

function getMainMenu() {
    return Markup.keyboard([
        ['➕ Додати сайт', '📋 Мої сайти'],
        ['📈 Статистика', '💎 Premium'],
        ['🗑 Очистити список', 'ℹ️ Допомога'],
        ['💬 Підтримка']
    ]).resize();
}

bot.start(async (ctx) => {
    const username = ctx.from.username ? `@${ctx.from.username}` : null;
    const firstName = ctx.from.first_name || 'Без імені';
    const userId = ctx.from.id.toString();
    let user = await prisma.user.findUnique({ where: { id: userId } });

    const welcomeText = `👋 <b>Вітаю! Цей бот виконує функції автоматичного моніторингу сайтів.</b>\n\n` +
        `Система цілодобово контролює доступність серверів, швидкість завантаження та автоматично перевіряє працездатність головних кнопок на вашій сторінці.\n\n` +
        `🎁 <b>Ваш подарунок:</b> 3 дні безкоштовного Trial-доступу (1 сайт).\n\n` +
        `👇 Натисніть <b>«➕ Додати сайт»</b>, щоб почати моніторинг, або <b>«ℹ️ Допомога»</b> для перегляду всіх можливостей та тарифів.`;

    if (!user) {
        const trialDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        user = await prisma.user.create({
            data: { id: userId, trialEndsAt: trialDate, username: username, firstName: firstName }
        });
    } else {
        await prisma.user.update({
            where: { id: userId },
            data: { username: username, firstName: firstName }
        });
    }
    await ctx.reply(welcomeText, { parse_mode: 'HTML', ...getMainMenu() });
});

bot.hears('➕ Додати сайт', async (ctx) => {
    const userId = ctx.from.id.toString();
    await connection.set(`awaiting_url:${userId}`, 'yes', 'EX', 300);
    ctx.reply('🔗 Будь ласка, надішліть мені посилання на сайт у цей чат (наприклад, example.com).');
});

bot.hears('ℹ️ Допомога', (ctx) => {
    const helpText = `🛠 <b>Як працює моніторинг?</b>\n\n` +
        `Кожні 15 хвилин система запускає прихований браузер і виконує такі кроки:\n\n` +
        `<b>1️⃣ Базова перевірка:</b> Вимірює швидкість з'єднання, загальний час завантаження сторінки та перевіряє валідність SSL-сертифіката.\n` +
        `<b>2️⃣ Візуальний аудит:</b> Аналізує зображення та знаходить ті, що не завантажились або вантажаться довше 1 секунди.\n` +
        `<b>3️⃣ Аналіз кнопки:</b> Алгоритм самостійно визначає Call-to-Action кнопку (кошик, реєстрація тощо) та імітує клік, перевіряючи реакцію сайту.\n` +
        `<b>4️⃣ Сповіщення:</b> Якщо виникає збій, система робить знімок екрана, аналізує сторінку з помилкою і миттєво надсилає вам попередження з описом проблеми.\n\n` +
        `📊 <b>Тарифи:</b>\n` +
        `• <b>Trial (3 дні):</b> 1 сайт, перевірки кожні 15 хв.\n` +
        `• <b>PRO (250 ⭐️/міс):</b> До 3 сайтів, перевірки кожні 15 хв.\n\n` +
        `💡 <i>Підказка: Використовуйте кнопку «📈 Статистика», щоб переглянути графік швидкості за сьогодні.</i>`;

    ctx.reply(helpText, { parse_mode: 'HTML' });
});

bot.hears('💬 Підтримка', async (ctx) => {
    const userId = ctx.from.id.toString();
    await connection.set(`awaiting_support:${userId}`, 'yes', 'EX', 600);
    ctx.reply('👨‍💻 <b>Служба підтримки</b>\n\nОпишіть вашу проблему, знайдений баг або ідею в одному повідомленні нижче.\nЯ миттєво передам його розробнику!', { parse_mode: 'HTML' });
});

bot.hears('📋 Мої сайти', async (ctx) => {
    const sites = await prisma.site.findMany({ where: { clientId: ctx.from.id.toString() } });
    if (sites.length === 0) return ctx.reply('У вас поки немає доданих сайтів. Натисніть "➕ Додати сайт".');

    let msg = '📋 <b>Ваші сайти на моніторингу:</b>\n\n';
    const inlineButtons = [];
    sites.forEach((site, idx) => {
        msg += `${idx + 1}. ${site.url} ${site.isActive ? '✅' : '⏸'}\n`;
        inlineButtons.push([Markup.button.callback(`❌ Видалити сайт №${idx + 1}`, `delete_site_${site.id}`)]);
    });
    ctx.reply(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(inlineButtons) });
});

bot.action(/^delete_site_(\d+)$/, async (ctx) => {
    const siteId = parseInt(ctx.match[1], 10);
    const userId = ctx.from.id.toString();
    try {
        const site = await prisma.site.findUnique({ where: { id: siteId } });
        if (!site || site.clientId !== userId) return ctx.answerCbQuery('❌ Помилка: Сайт не знайдено.', { show_alert: true });

        await prisma.monitorLog.deleteMany({ where: { siteId: siteId } });
        await prisma.site.delete({ where: { id: siteId } });

        await ctx.answerCbQuery('✅ Сайт успішно видалено!');
        await ctx.editMessageText(`✅ Сайт <b>${site.url}</b> успішно видалено зі списку.`, { parse_mode: 'HTML' });
    } catch (error) {
        await ctx.answerCbQuery('❌ Сталася помилка при видаленні.', { show_alert: true });
    }
});

bot.hears('🗑 Очистити список', async (ctx) => {
    const userId = ctx.from.id.toString();
    try {
        const userSites = await prisma.site.findMany({ where: { clientId: userId } });
        const siteIds = userSites.map(site => site.id);
        if (siteIds.length > 0) await prisma.monitorLog.deleteMany({ where: { siteId: { in: siteIds } } });
        await prisma.site.deleteMany({ where: { clientId: userId } });
        ctx.reply('🗑 <b>Всі ваші сайти та історія видалені!</b>', { parse_mode: 'HTML', ...getMainMenu() });
    } catch (error) {
        ctx.reply('❌ Не вдалося очистити список сайтів.');
    }
});

bot.hears('📈 Статистика', async (ctx) => {
    const userId = ctx.from.id.toString();
    const sites = await prisma.site.findMany({ where: { clientId: userId } });

    if (sites.length === 0) return ctx.reply('Спочатку додайте сайт, щоб переглянути статистику.');

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    for (const site of sites) {
        const logs = await prisma.monitorLog.findMany({
            where: {
                siteId: site.id,
                createdAt: { gte: startOfDay }
            },
            orderBy: { createdAt: 'asc' }
        });

        if (logs.length === 0) {
            await ctx.reply(`📊 Для сайту ${site.url} сьогодні ще немає перевірок.`);
            continue;
        }

        const labels = logs.map(log => {
            const d = new Date(log.createdAt);
            return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
        });
        const dataPoints = logs.map(log => log.ping);

        const chartConfig = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Пінг (мс)',
                    data: dataPoints,
                    borderColor: 'rgb(46, 204, 113)',
                    backgroundColor: 'rgba(46, 204, 113, 0.2)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4
                }]
            },
            options: { title: { display: true, text: `Статистика за сьогодні: ${site.url}` }, legend: { display: false } }
        };

        const chartUrl = `https://quickchart.io/chart?w=600&h=300&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

        const totalChecks = logs.length;
        const successfulChecks = logs.filter(log => log.isSuccess).length;
        const uptime = Math.round((successfulChecks / totalChecks) * 100);
        const avgPing = Math.round(dataPoints.reduce((a, b) => a + b, 0) / totalChecks);

        const statText = `📊 <b>Денний звіт: ${site.url}</b>\n` +
            `⏱ Всього: ${totalChecks} | ✅ Uptime: ${uptime}% | ⚡️ Сер. Пінг: ${avgPing} мс\n\n` +
            `👇 <b>ОСТАННІЙ ДЕТАЛЬНИЙ АУДИТ:</b> 👇`;

        const redisAudit = await connection.get(`audit:${site.id}`);
        const finalCaption = statText + `\n\n` + (redisAudit || '<i>Детальний аудит ще не сформовано воркером. Зачекайте наступної перевірки.</i>');

        await ctx.replyWithPhoto(chartUrl, { caption: finalCaption, parse_mode: 'HTML' });
    }
});

bot.hears('💎 Premium', async (ctx) => {
    await ctx.replyWithInvoice({
        title: 'Підписка PRO',
        description: 'Розблокуйте до 3 сайтів, перевірки кожні 15 хв та детальну аналітику.',
        payload: `premium_sub_${ctx.from.id}`,
        provider_token: "",
        currency: 'XTR',
        prices: [{ label: 'Доступ PRO (Місяць)', amount: 250 }]
    });
});
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));
bot.on('successful_payment', async (ctx) => {
    await prisma.user.update({ where: { id: ctx.from.id.toString() }, data: { isPremium: true } });
    await ctx.reply('🎉 <b>Оплата успішна!</b> Статус PRO активовано.', { parse_mode: 'HTML' });
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (['➕ Додати сайт', '📋 Мої сайти', '🗑 Очистити список', '📈 Статистика', '💎 Premium', 'ℹ️ Допомога', '💬 Підтримка'].includes(text)) return;

    const userId = ctx.from.id.toString();

    if (userId === ADMIN_ID && ctx.message.reply_to_message) {
        const originalText = ctx.message.reply_to_message.text || '';
        const match = originalText.match(/ID: (\d+)/);

        if (match) {
            const clientId = match[1];
            try {
                await bot.telegram.sendMessage(clientId, `👨‍💻 <b>Відповідь від підтримки:</b>\n\n${text}`, { parse_mode: 'HTML' });
                return ctx.reply('✅ Відповідь успішно надіслано клієнту!');
            } catch (err) {
                return ctx.reply('❌ Помилка: Не вдалося надіслати. Можливо, клієнт заблокував бота.');
            }
        }
    }

    const isAwaitingSupport = await connection.get(`awaiting_support:${userId}`);
    if (isAwaitingSupport) {
        await connection.del(`awaiting_support:${userId}`);
        const ticketText = `📩 <b>Нове звернення (Підтримка)</b>\n👤 Клієнт: ${ctx.from.first_name} (ID: ${userId})\n\n💬 <i>${text}</i>`;
        await bot.telegram.sendMessage(ADMIN_ID, ticketText, { parse_mode: 'HTML' });
        return ctx.reply('✅ Ваше повідомлення успішно надіслано! Адміністратор відповість вам найближчим часом.');
    }

    const isAwaitingUrl = await connection.get(`awaiting_url:${userId}`);
    if (!isAwaitingUrl) return ctx.reply('🤔 Я вас не розумію. Використовуйте кнопки меню нижче 👇');

    if (!text.includes('.')) return ctx.reply('❌ Це не схоже на адресу сайту (наприклад, example.com).');

    let cleanUrl;
    try {
        const rawUrl = new URL(text.startsWith('http') ? text : `https://${text}`);

      
        const hostname = rawUrl.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
            return ctx.reply('❌ Додавання локальних або системних адрес заборонено з міркувань безпеки.');
        }

        cleanUrl = rawUrl.origin + rawUrl.pathname;
    } catch {
        return ctx.reply('❌ Надішліть коректне посилання.');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return ctx.reply('Будь ласка, натисніть /start.');

    const existingSite = await prisma.site.findFirst({ where: { clientId: userId, url: cleanUrl } });
    if (existingSite) {
        await connection.del(`awaiting_url:${userId}`);
        return ctx.reply('⚠️ Цей сайт вже є у списку!');
    }

    const siteCount = await prisma.site.count({ where: { clientId: userId } });
    const maxSites = user.isPremium ? 3 : (user.trialEndsAt > new Date() ? 1 : 0);

    if (siteCount >= maxSites) {
        await connection.del(`awaiting_url:${userId}`);
        return ctx.reply(maxSites === 0 ? '🔒 Тріал завершено. Придбайте Premium.' : `🔒 Ваш ліміт (${maxSites}) вичерпано.`);
    }

    try {
        const newSite = await prisma.site.create({ data: { url: cleanUrl, clientId: userId, isActive: true } });
        await monitorQueue.add('check', { targetUrl: newSite.url, clientId: newSite.clientId, siteId: newSite.id });
        await connection.del(`awaiting_url:${userId}`);
        ctx.reply(`✅ Сайт <b>${cleanUrl}</b> додано!\nПерша перевірка вже розпочалася.`, { parse_mode: 'HTML' });
    } catch (e) {
        console.error(e);
    }
});

let minuteTick = 0;
setInterval(async () => {
    minuteTick++;
    try {
        const sites = await prisma.site.findMany({ where: { isActive: true }, include: { user: true } });
        const now = new Date();
        for (const site of sites) {
            const hasAccess = site.user.isPremium || site.user.trialEndsAt > now;
            if (hasAccess) {
                if (minuteTick % 15 === 0) {
                    monitorQueue.add('check', { targetUrl: site.url, clientId: site.clientId, siteId: site.id });
                }
            } else {
                const warnedKey = `trial_warned:${site.clientId}`;
                if (!await connection.get(warnedKey)) {
                    await bot.telegram.sendMessage(site.clientId, `⚠️ Тріал завершено для <b>${site.url}</b>.`, { parse_mode: 'HTML' });
                    await connection.set(warnedKey, 'yes', 'EX', 86400 * 30);
                }
            }
        }
    } catch (error) { console.error('Помилка планувальника:', error); }
}, 60000);

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
