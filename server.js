const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));
app.use(express.json());

// Admin keys (gerçek uygulamada environment variable kullan)
const ADMIN_KEYS = ['HACK2024', 'ADMIN123', 'CREATOR'];

// Quiz database (Firebase yerine geçici)
const quizDatabase = new Map();

// Örnek quizleri yükle
const sampleQuizzes = require('./sample-quizzes');
sampleQuizzes.forEach(quiz => {
    quizDatabase.set(quiz.id, quiz);
});

// Oyun odaları
const rooms = new Map();

// PIN oluştur
function generatePin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Admin key kontrol
app.post('/api/verify-key', (req, res) => {
    const { key } = req.body;
    if (ADMIN_KEYS.includes(key)) {
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Geçersiz key!' });
    }
});

// Quiz kaydet
app.post('/api/save-quiz', (req, res) => {
    const { key, quiz } = req.body;
    
    if (!ADMIN_KEYS.includes(key)) {
        return res.json({ success: false, message: 'Yetkisiz!' });
    }
    
    const quizId = Date.now().toString();
    quizDatabase.set(quizId, {
        id: quizId,
        ...quiz,
        createdAt: new Date().toISOString()
    });
    
    res.json({ success: true, quizId });
});

// Quiz listesi
app.get('/api/quizzes', (req, res) => {
    const quizzes = Array.from(quizDatabase.values());
    res.json(quizzes);
});

// Quiz detay
app.get('/api/quiz/:id', (req, res) => {
    const quiz = quizDatabase.get(req.params.id);
    if (quiz) {
        res.json(quiz);
    } else {
        res.status(404).json({ error: 'Quiz bulunamadı' });
    }
});

// Quiz sil
app.delete('/api/quiz/:id', (req, res) => {
    const { key } = req.body;
    
    if (!ADMIN_KEYS.includes(key)) {
        return res.json({ success: false, message: 'Yetkisiz!' });
    }
    
    const quizId = req.params.id;
    if (quizDatabase.has(quizId)) {
        quizDatabase.delete(quizId);
        res.json({ success: true, message: 'Quiz silindi!' });
    } else {
        res.status(404).json({ success: false, message: 'Quiz bulunamadı!' });
    }
});

io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    // Host oda oluştur
    socket.on('create-room', ({ quizId }) => {
        const quiz = quizDatabase.get(quizId);
        if (!quiz) {
            socket.emit('room-error', { message: 'Quiz bulunamadı!' });
            return;
        }
        
        const pin = generatePin();
        rooms.set(pin, {
            pin: pin,
            hostId: socket.id,
            quizId: quizId,
            quiz: quiz,
            players: new Map(),
            gameState: 'waiting', // waiting, playing, reward, finished
            currentQuestion: -1,
            questionsAnswered: 0,
            gameSpeed: 1.0,
            gameTimer: null,
            gameDuration: 0, // Dakika cinsinden
            timeRemaining: 0, // Saniye cinsinden
            startTime: null
        });
        
        socket.join(pin);
        socket.emit('room-created', { pin, quiz });
        console.log(`Oda oluşturuldu: ${pin} - Quiz: ${quiz.title}`);
    });

    // Oyuncu odaya katıl ve şifre seç
    socket.on('join-room', ({ pin, nickname, password }) => {
        const room = rooms.get(pin);
        
        if (!room) {
            socket.emit('join-error', { message: 'Oda bulunamadı!' });
            return;
        }

        if (room.gameState !== 'waiting') {
            socket.emit('join-error', { message: 'Oyun zaten başlamış!' });
            return;
        }

        // Şifrenin benzersiz olup olmadığını kontrol et
        const existingPasswords = Array.from(room.players.values()).map(p => p.password);
        if (existingPasswords.includes(password)) {
            socket.emit('join-error', { message: 'Bu şifre alınmış! Başka bir şifre seç.' });
            return;
        }

        room.players.set(socket.id, {
            id: socket.id,
            nickname: nickname,
            password: password,
            score: 0,
            streak: 0,
            isHacked: false,
            correctAnswers: 0
        });

        socket.join(pin);
        socket.emit('join-success', { pin });

        const playerList = Array.from(room.players.values());
        io.to(pin).emit('player-list-update', { players: playerList });

        console.log(`${nickname} odaya katıldı: ${pin}`);
    });

    // Oyun başlat (süre ile)
    socket.on('start-game', ({ pin, duration }) => {
        const room = rooms.get(pin);
        
        if (!room || room.hostId !== socket.id) {
            return;
        }

        if (room.players.size === 0) {
            socket.emit('game-error', { message: 'Oyuncu yok!' });
            return;
        }

        room.gameState = 'playing';
        room.currentQuestion = 0;
        room.questionsAnswered = 0;
        room.gameDuration = duration; // Dakika
        room.timeRemaining = duration * 60; // Saniyeye çevir
        room.startTime = Date.now();

        // Zamanlayıcı başlat
        room.gameTimer = setInterval(() => {
            room.timeRemaining--;
            
            // Her saniye skorları ve zamanı güncelle
            io.to(pin).emit('time-update', { 
                timeRemaining: room.timeRemaining,
                minutes: Math.floor(room.timeRemaining / 60),
                seconds: room.timeRemaining % 60
            });
            
            // Süre bitti
            if (room.timeRemaining <= 0) {
                clearInterval(room.gameTimer);
                endGame(pin);
            }
        }, 1000);

        io.to(pin).emit('game-started', {
            duration: duration,
            timeRemaining: room.timeRemaining
        });
        
        // İlk soruyu gönder
        sendQuestion(pin);

        console.log(`Oyun başladı: ${pin} - Süre: ${duration} dakika`);
    });

    // Soru gönder
    function sendQuestion(pin) {
        const room = rooms.get(pin);
        if (!room) return;

        const question = room.quiz.questions[room.currentQuestion];
        
        // Cevapları karıştır
        const shuffledOptions = [...question.options];
        const correctOption = shuffledOptions[question.correctAnswer];
        
        // Fisher-Yates shuffle algoritması
        for (let i = shuffledOptions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
        }
        
        // Yeni doğru cevap indexini bul
        const newCorrectIndex = shuffledOptions.indexOf(correctOption);
        
        // Karıştırılmış soruyu kaydet (cevap kontrolü için)
        room.currentQuestionData = {
            correctAnswer: newCorrectIndex,
            originalCorrectAnswer: question.correctAnswer
        };
        
        io.to(pin).emit('new-question', {
            question: {
                ...question,
                options: shuffledOptions,
                correctAnswer: undefined // Güvenlik için gönderme
            },
            questionNumber: room.currentQuestion + 1,
            totalQuestions: room.quiz.questions.length,
            timeLimit: question.timeLimit || 20
        });
    }

    // Cevap gönder
    socket.on('submit-answer', ({ pin, answer, timeSpent }) => {
        const room = rooms.get(pin);
        
        if (!room || !room.players.has(socket.id)) {
            return;
        }

        const player = room.players.get(socket.id);
        
        // Karıştırılmış cevapla kontrol et
        const isCorrect = answer === room.currentQuestionData.correctAnswer;
        
        if (isCorrect) {
            const timeBonus = Math.max(1000 - (timeSpent * 50), 100);
            const streakBonus = player.streak * 100;
            const totalScore = 1000 + timeBonus + streakBonus;
            
            player.score += totalScore;
            player.streak++;
            player.correctAnswers++;
            
            socket.emit('answer-result', {
                correct: true,
                score: totalScore,
                newTotal: player.score
            });
        } else {
            player.streak = 0;
            socket.emit('answer-result', {
                correct: false,
                score: 0,
                newTotal: player.score
            });
        }

        // Skorları güncelle
        updateScoreboard(pin);
    });

    // Sonraki soru
    socket.on('next-question', ({ pin }) => {
        const room = rooms.get(pin);
        
        if (!room || room.hostId !== socket.id) {
            return;
        }

        room.currentQuestion++;
        room.questionsAnswered++;

        // Her 3 soruda bir ödül
        if (room.questionsAnswered > 0 && room.questionsAnswered % 3 === 0) {
            room.gameState = 'reward';
            io.to(pin).emit('reward-time', {
                message: 'ÖDÜL ZAMANI!',
                speed: room.gameSpeed
            });
        } else if (room.currentQuestion >= room.quiz.questions.length) {
            endGame(pin);
        } else {
            sendQuestion(pin);
        }
    });

    // Ödül seçimi
    socket.on('reward-selected', ({ pin, playerId, reward }) => {
        const room = rooms.get(pin);
        if (!room) return;

        const player = room.players.get(playerId);
        if (!player) return;

        switch(reward) {
            case 'minigame':
                io.to(playerId).emit('start-minigame', { speed: room.gameSpeed });
                break;
            case 'hack':
                // Diğer oyuncuların şifrelerini gönder
                const otherPlayers = Array.from(room.players.values())
                    .filter(p => p.id !== playerId && !p.isHacked)
                    .map(p => ({
                        id: p.id,
                        nickname: p.nickname,
                        score: p.score
                    }));
                io.to(playerId).emit('start-hack', { 
                    players: otherPlayers,
                    speed: room.gameSpeed 
                });
                break;
            case 'nothing':
                io.to(playerId).emit('reward-nothing');
                break;
        }
    });

    // Hack başarılı
    socket.on('hack-success', ({ pin, hackerId, targetId, stolenPoints }) => {
        const room = rooms.get(pin);
        if (!room) return;

        const hacker = room.players.get(hackerId);
        const target = room.players.get(targetId);

        if (hacker && target) {
            const stolen = Math.min(stolenPoints, target.score);
            target.score -= stolen;
            hacker.score += stolen;
            target.isHacked = true;

            io.to(targetId).emit('got-hacked', { 
                by: hacker.nickname, 
                lost: stolen 
            });
            
            io.to(hackerId).emit('hack-complete', { 
                stolen: stolen, 
                from: target.nickname 
            });

            updateScoreboard(pin);
        }
    });

    // Minigame tamamlandı
    socket.on('minigame-complete', ({ pin, playerId, earnedPoints }) => {
        const room = rooms.get(pin);
        if (!room) return;

        const player = room.players.get(playerId);
        if (player) {
            player.score += earnedPoints;
            updateScoreboard(pin);
            io.to(playerId).emit('minigame-result', { earned: earnedPoints });
        }
    });

    // Ödül bitti, devam et
    socket.on('continue-game', ({ pin }) => {
        const room = rooms.get(pin);
        
        if (!room || room.hostId !== socket.id) {
            return;
        }

        room.gameState = 'playing';
        
        // Hızı artır
        if (room.questionsAnswered % 6 === 0) {
            room.gameSpeed += 0.2;
        }

        if (room.currentQuestion >= room.quiz.questions.length) {
            endGame(pin);
        } else {
            sendQuestion(pin);
        }
    });

    // Skorları güncelle
    function updateScoreboard(pin) {
        const room = rooms.get(pin);
        if (!room) return;

        const scores = Array.from(room.players.values())
            .map(p => ({ 
                id: p.id,
                nickname: p.nickname, 
                score: p.score,
                isHacked: p.isHacked
            }))
            .sort((a, b) => b.score - a.score);

        io.to(pin).emit('score-update', { scores });
    }

    // Oyunu bitir
    function endGame(pin) {
        const room = rooms.get(pin);
        if (!room) return;

        // Zamanlayıcıyı temizle
        if (room.gameTimer) {
            clearInterval(room.gameTimer);
            room.gameTimer = null;
        }

        const finalScores = Array.from(room.players.values())
            .map(p => ({ 
                nickname: p.nickname, 
                score: p.score,
                correctAnswers: p.correctAnswers
            }))
            .sort((a, b) => b.score - a.score);

        io.to(pin).emit('game-ended', { 
            scores: finalScores,
            reason: room.timeRemaining <= 0 ? 'time' : 'manual'
        });
        room.gameState = 'finished';
    }

    socket.on('end-game', ({ pin }) => {
        const room = rooms.get(pin);
        if (!room || room.hostId !== socket.id) return;
        endGame(pin);
    });

    // Oyuncu at (Host)
    socket.on('kick-player', ({ pin, playerId }) => {
        const room = rooms.get(pin);
        
        if (!room || room.hostId !== socket.id) {
            return;
        }

        if (room.players.has(playerId)) {
            room.players.delete(playerId);
            
            // Oyuncuya bildir
            io.to(playerId).emit('kicked', { message: 'Host tarafından atıldınız!' });
            
            // Diğer oyunculara güncelleme gönder
            const playerList = Array.from(room.players.values());
            io.to(pin).emit('player-list-update', { players: playerList });
            
            console.log(`Oyuncu atıldı: ${playerId} - Oda: ${pin}`);
        }
    });

    // Bağlantı kopma
    socket.on('disconnect', () => {
        console.log('Bağlantı koptu:', socket.id);

        rooms.forEach((room, pin) => {
            if (room.hostId === socket.id) {
                // Zamanlayıcıyı temizle
                if (room.gameTimer) {
                    clearInterval(room.gameTimer);
                }
                io.to(pin).emit('host-disconnected');
                rooms.delete(pin);
                console.log(`Oda kapatıldı: ${pin}`);
            } else if (room.players.has(socket.id)) {
                room.players.delete(socket.id);
                const playerList = Array.from(room.players.values());
                io.to(pin).emit('player-list-update', { players: playerList });
            }
        });
    });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(`🎮 HACK ARENA v2.0 Sunucu Çalışıyor!`);
    console.log(`==============================================`);
    console.log(`📡 Sunucu: http://localhost:${PORT}`);
    console.log(`🌐 Ağ: http://<IP-ADRESIN>:${PORT}`);
    console.log(`\n🔑 Admin Keys: ${ADMIN_KEYS.join(', ')}`);
    console.log(`📝 Quiz Oluştur: http://localhost:${PORT}/create.html`);
    console.log(`🎮 Host Panel: http://localhost:${PORT}/host.html`);
    console.log(`👤 Oyuncu: http://localhost:${PORT}`);
    console.log(`==============================================\n`);
});
