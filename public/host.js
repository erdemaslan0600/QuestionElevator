const socket = io();

let currentPin = null;
let players = [];
let selectedQuizId = null;
let selectedDuration = 10; // Varsayılan 10 dakika

// Sayfa yüklendiğinde quizleri getir
window.addEventListener('load', async () => {
    try {
        const response = await fetch('/api/quizzes');
        const quizzes = await response.json();
        displayQuizList(quizzes);
    } catch (error) {
        document.getElementById('quiz-list').innerHTML = 
            '<p style="color:var(--danger-color);">Quizler yüklenemedi!</p>';
    }
});

// Quiz listesini göster
function displayQuizList(quizzes) {
    const listEl = document.getElementById('quiz-list');
    
    if (quizzes.length === 0) {
        listEl.innerHTML = '<p style="text-align:center; color:var(--text-dim);">Henüz quiz yok. Yeni bir tane oluştur!</p>';
        return;
    }
    
    listEl.innerHTML = quizzes.map(quiz => `
        <div class="quiz-item" onclick="selectQuiz('${quiz.id}')">
            <div class="quiz-item-content">
                <h3>${quiz.title}</h3>
                <p>${quiz.description}</p>
                <span class="quiz-info">${quiz.questions.length} soru</span>
            </div>
            <button class="btn-delete-quiz" onclick="event.stopPropagation(); deleteQuiz('${quiz.id}')" title="Quiz'i Sil">
                🗑️
            </button>
        </div>
    `).join('');
}

// Quiz sil
async function deleteQuiz(quizId) {
    const key = prompt('Quiz silmek için admin key girin:');
    if (!key) return;
    
    try {
        const response = await fetch(`/api/quiz/${quizId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Quiz silindi!');
            // Listeyi yenile
            const quizzesResponse = await fetch('/api/quizzes');
            const quizzes = await quizzesResponse.json();
            displayQuizList(quizzes);
        } else {
            alert(data.message || 'Quiz silinemedi!');
        }
    } catch (error) {
        alert('Bağlantı hatası!');
    }
}

// Quiz seç ve oda oluştur
function selectQuiz(quizId) {
    selectedQuizId = quizId;
    socket.emit('create-room', { quizId });
}

// Oda oluşturuldu
socket.on('room-created', ({ pin, quiz }) => {
    currentPin = pin;
    document.getElementById('pin-code').textContent = pin;
    
    // URL'i göster
    const hostname = window.location.hostname;
    const port = window.location.port;
    const url = `http://${hostname}${port ? ':' + port : ''}`;
    document.getElementById('join-url').textContent = url;
    
    showScreen('lobby-screen');
});

// Oyuncu listesi güncelle
socket.on('player-list-update', ({ players: playerList }) => {
    players = playerList;
    document.getElementById('player-count').textContent = players.length;
    
    const listEl = document.getElementById('players-list');
    
    if (players.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><p>Oyuncular bekleniyor...</p></div>';
    } else {
        listEl.innerHTML = players.map(player => `
            <div class="player-card">
                <span class="player-icon">👤</span>
                <span class="player-name">${player.nickname}</span>
                <span class="player-score">${player.score} pts</span>
                <button class="btn-kick" onclick="kickPlayer('${player.id}')">✕</button>
            </div>
        `).join('');
    }
});

// Oyuncu at
function kickPlayer(playerId) {
    if (confirm('Bu oyuncuyu atmak istediğinize emin misiniz?')) {
        socket.emit('kick-player', { pin: currentPin, playerId });
    }
}

// Süre seç
function selectDuration(duration) {
    selectedDuration = duration;
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-duration="${duration}"]`).classList.add('active');
}

// Oyun başlat (süre ile)
function startGameWithTime() {
    if (players.length === 0) {
        alert('En az 1 oyuncu gerekli!');
        return;
    }
    
    socket.emit('start-game', { pin: currentPin, duration: selectedDuration });
    showScreen('game-screen');
}

// Oyun başladı
socket.on('game-started', ({ duration, timeRemaining }) => {
    updateTimeDisplay(timeRemaining);
});

// Zaman güncelle
socket.on('time-update', ({ timeRemaining, minutes, seconds }) => {
    updateTimeDisplay(timeRemaining);
});

// Zaman göstergesi
function updateTimeDisplay(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const display = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    document.getElementById('time-display').textContent = display;
    
    // Son 30 saniye kırmızı yap
    const timerEl = document.getElementById('time-display');
    if (seconds <= 30) {
        timerEl.style.color = 'var(--danger-color)';
        timerEl.style.animation = 'pulse 1s infinite';
    } else if (seconds <= 60) {
        timerEl.style.color = 'var(--warning-color)';
    } else {
        timerEl.style.color = 'var(--success-color)';
        timerEl.style.animation = 'none';
    }
}

// Oyun başlat (eski fonksiyon - kaldırıldı)
function startGameForAll(gameType) {
    // Bu fonksiyon artık kullanılmıyor
}

// Skor güncelle
socket.on('score-update', ({ scores }) => {
    const listEl = document.getElementById('scoreboard-list');
    
    listEl.innerHTML = scores.map((player, index) => `
        <div class="score-item ${index === 0 ? 'winner' : ''}">
            <span class="score-rank">#${index + 1}</span>
            <span class="score-name">${player.nickname}</span>
            <span class="score-value">${player.score}</span>
        </div>
    `).join('');
});

// Sonraki oyun
function nextGame() {
    showScreen('lobby-screen');
}

// Oyunu bitir
function endGame() {
    socket.emit('end-game', { pin: currentPin });
}

// Oyun bitti
socket.on('game-ended', ({ scores, reason }) => {
    const resultsEl = document.getElementById('final-results');
    
    const reasonText = reason === 'time' 
        ? '<p style="color:var(--warning-color); margin-bottom:20px; font-size:1.2em;">⏰ Süre Doldu!</p>' 
        : '';
    
    resultsEl.innerHTML = reasonText + scores.map((player, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
        return `
            <div class="final-score-item">
                <span class="final-medal">${medal}</span>
                <span class="final-name">${player.nickname}</span>
                <span class="final-score">${player.score} PTS</span>
            </div>
        `;
    }).join('');
    
    showScreen('results-screen');
});

// Lobiye dön
function backToLobby() {
    showScreen('lobby-screen');
}

// Oturumu kapat
function endSession() {
    if (confirm('Oturumu kapatmak istediğinize emin misiniz?')) {
        location.reload();
    }
}

// Ekran geçişi
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

// Hata
socket.on('game-error', ({ message }) => {
    alert(message);
});
