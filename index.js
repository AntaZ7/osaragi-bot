// Osaragi WhatsApp Bot Full Version
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const axios = require('axios');
const moment = require('moment-timezone');
const Boom = require('@hapi/boom');
const cheerio = require('cheerio');
const Jimp = require('jimp');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

const prefix = '.';
const ownerNumber = '6287846264834';
let afk = {};

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    version,
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
  });

  conn.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'close') {
      const reason = Boom.boomify(lastDisconnect?.error)?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        console.log('🔴 Logout, hapus session...');
        fs.rmSync('./session', { recursive: true, force: true });
        startSock();
      } else {
        console.log('🔁 Koneksi ulang...');
        startSock();
      }
    } else if (connection === 'open') {
      console.log('✅ Bot Osaragi aktif!');
    }
  });

  conn.ev.on('creds.update', saveCreds);

  conn.ev.on('messages.upsert', async ({ messages }) => {
    if (!messages || !messages[0].message) return;
    const m = messages[0];
    if (m.key.remoteJid === 'status@broadcast') return;

    const from = m.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const sender = isGroup ? m.key.participant : m.key.remoteJid;
    const body = m.message.conversation || m.message.extendedTextMessage?.text || '';
    const command = body.startsWith(prefix) ? body.slice(1).split(' ')[0].toLowerCase() : '';
    const args = body.trim().split(/ +/).slice(1);
    const isOwner = (sender || '').includes(ownerNumber);

    if (body.toLowerCase().includes('osaragi')) {
      await conn.sendMessage(from, { text: 'iya kak?' });
    }

    if (afk[sender] && !m.key.fromMe) {
      const waktuAfk = moment.duration(Date.now() - afk[sender].time).humanize();
      delete afk[sender];
      await conn.sendMessage(from, {
        text: `👋 Selamat datang kembali @${sender.split('@')[0]}!\nKamu AFK selama ${waktuAfk}.`,
        mentions: [sender],
      });
    }

    if (m.message?.extendedTextMessage?.contextInfo?.mentionedJid) {
      for (let jid of m.message.extendedTextMessage.contextInfo.mentionedJid) {
        if (afk[jid]) {
          const since = moment.duration(Date.now() - afk[jid].time).humanize();
          await conn.sendMessage(from, {
            text: `@${jid.split('@')[0]} sedang AFK\n📝 ${afk[jid].reason}\n⏱️ ${since} lalu`,
            mentions: [jid],
          });
        }
      }
    }

    if (command === 'ping') {
      await conn.sendMessage(from, { text: 'Bot aktif kak ✅' });
    }

    if (command === 'afk') {
      afk[sender] = {
        reason: args.join(' ') || 'Tanpa alasan',
        time: Date.now(),
      };
      await conn.sendMessage(from, { text: `AFK diaktifkan\n📝: ${afk[sender].reason}` });
    }

    if (command === 's') {
      let quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      let mediaMsg = m.message?.imageMessage
        ? m
        : quoted?.imageMessage
        ? {
            message: { imageMessage: quoted.imageMessage },
            key: {
              remoteJid: from,
              id: m.message.extendedTextMessage.contextInfo.stanzaId,
              fromMe: false,
              participant: m.message.extendedTextMessage.contextInfo.participant,
            },
          }
        : null;

      if (!mediaMsg) return conn.sendMessage(from, { text: '❌ Kirim atau balas gambar dengan .s' });

      try {
        const buffer = await downloadMediaMessage(mediaMsg, 'buffer', {}, { logger: conn.logger, reuploadRequest: conn.updateMediaMessage });
        const sticker = new Sticker(buffer, {
          pack: 'OsaragiBot',
          author: 'axta',
          type: StickerTypes.FULL,
          quality: 70,
        });
        const stickerBuffer = await sticker.toBuffer();
        await conn.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });
      } catch (err) {
        console.error('❌ Gagal bikin stiker:', err);
        await conn.sendMessage(from, { text: '❌ Gagal membuat stiker.' });
      }
    }

    if (command === 'menu') {
      await conn.sendMessage(from, {
        text: `📋 *Menu Osaragi:*\n• .ping\n• .s\n• .afk [alasan]\n• .buka / .tutup\n• .tagall\n• .hidetag [pesan]\n• .bersihkan\n• .tiktok [url]\n• .ssweb [url]\n• .hytamkan (gambar)`
      });
    }

    if (['buka', 'tutup'].includes(command) && isGroup) {
      const setting = command === 'buka' ? 'not_announcement' : 'announcement';
      await conn.groupSettingUpdate(from, setting);
      await conn.sendMessage(from, { text: `Grup berhasil di-${command}` });
    }

    if (command === 'bersihkan' && isOwner) {
      const chats = await conn.chats.all();
      for (let chat of chats) {
        await conn.chatModify({ clear: { message: { id: chat.messages?.last?.key?.id, fromMe: true } } }, chat.id);
      }
      await conn.sendMessage(from, { text: 'Semua chat dibersihkan ✅' });
    }

    if (command === 'tagall' && isGroup) {
      const metadata = await conn.groupMetadata(from);
      let text = '*👥 Tag Semua:*\n';
      let mentions = metadata.participants.map(p => p.id);
      text += mentions.map(id => `@${id.split('@')[0]}`).join('\n');
      await conn.sendMessage(from, { text, mentions });
    }

    if (command === 'hidetag' && isGroup) {
      const metadata = await conn.groupMetadata(from);
      const mentions = metadata.participants.map(p => p.id);
      const text = args.join(' ') || '';
      await conn.sendMessage(from, { text, mentions });
    }

    if (['tiktok', 'tt'].includes(command)) {
      if (!args[0]) return conn.sendMessage(from, { text: 'Masukkan URL TikTok.' });
      try {
        const tiktokURL = args[0];
        const api = `https://tikwm.com/api/?url=${encodeURIComponent(tiktokURL)}`;
        const res = await axios.get(api);
        const video = res.data?.data?.play;
        if (!video) throw new Error('Video tidak ditemukan');
        await conn.sendMessage(from, {
          video: { url: video },
          caption: '✅ Video berhasil diunduh!'
        });
      } catch (err) {
        console.error('❌ Gagal unduh TikTok:', err);
        await conn.sendMessage(from, { text: '❌ Gagal unduh TikTok: Video tidak ditemukan' });
      }
    }

    if (command === 'ssweb') {
      if (!args[0]) return conn.sendMessage(from, { text: 'Masukkan URL website.' });
      try {
        const url = args[0];
        const ss = `https://image.thum.io/get/fullpage/${url}`;
        await conn.sendMessage(from, {
          image: { url: ss },
          caption: '✅ Screenshot berhasil'
        });
      } catch (err) {
        console.error('❌ Gagal screenshot:', err);
        await conn.sendMessage(from, { text: '❌ Gagal screenshot website.' });
      }
    }

    if (command === 'hytamkan') {
      let quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      let mediaMsg = m.message?.imageMessage
        ? m
        : quoted?.imageMessage
        ? {
            message: { imageMessage: quoted.imageMessage },
            key: {
              remoteJid: from,
              id: m.message.extendedTextMessage.contextInfo.stanzaId,
              fromMe: false,
              participant: m.message.extendedTextMessage.contextInfo.participant,
            },
          }
        : null;

      if (!mediaMsg) return conn.sendMessage(from, { text: '❌ Kirim atau balas gambar dengan .hytamkan' });

      try {
        const buffer = await downloadMediaMessage(mediaMsg, 'buffer', {}, { logger: conn.logger, reuploadRequest: conn.updateMediaMessage });
        const image = await Jimp.read(buffer);
        image.color([{ apply: 'desaturate', params: [70] }, { apply: 'darken', params: [40] }]);
        const darkBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
        await conn.sendMessage(from, { image: darkBuffer, caption: '✅ Gambar dihytamkan.' }, { quoted: m });
      } catch (err) {
        console.error('❌ Gagal hytamkan:', err);
        await conn.sendMessage(from, { text: '❌ Gagal memproses gambar.' });
      }
    }

    await sleep(700); // global delay
  });
}

startSock();
