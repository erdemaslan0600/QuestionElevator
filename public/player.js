const socket = io();

let playerNickname = '';
let currentPin = '';
let playerScore = 0;
let gameStartTime = 0;

// Odaya katıl
function joinRoom() {
    const nickname = document.getElementById('nickname-input').value.trim();
    const pin = document.getElementById('pin-input').value.trim();
    
    if (!nickname || !pin) {
        showError('İsim ve PIN kodu gerekli!');
        return;
    }
    
    playerNickname = nickname;
    currentPin = pin;
    
    socket.emit('join-room', { pin, nickname });
}

// Katılma başarılı
socket.on('join-success', ({ pin }) => {
    document.getElementById('player-nickname').textContent = playerNickname;
    document.getElementById('room-pin').textContent = pin;
    showScreen('waiting-screen');
});

// Katılma hatası
socket.on('join-error', ({ message }) => {
    showError(message);
});

// Oyun başladı
socket.on('game-started', ({ gameType, gameData }) => {
    gameStartTime = Date.now();
    showScreen('player-game-screen');
    
    const gameNames = {
        'password': 'Şifre Kırma',
        'cipher': 'Kod Çözme',
        'wire': 'Kablo Kesme',
        'typing': 'Hızlı Kodlama',
        'sequence': 'Dizilim Hack',
        'memory': 'Bellek Hack'
    };
    
    document.getElementById('player-game-title').textContent = gameNames[gameType];
    renderGame(gameType, gameData);
});

// Oyun render
function renderGame(gameType, gameData) {
    const content = document.getElementById('player-game-content');
    
    switch(gameType) {
        case 'password':
            content.innerHTML = `
                <div class="password-game">
                    <div class="game-instruction">
                        <p>4 haneli şifreyi tahmin et!</p>
                    </div>
                    <input type="number" id="game-input" placeholder="0000" maxlength="4" />
                    <button class="btn-primary" onclick="submitAnswer()">Gönder</button>
                </div>
            `;
            break;
        
        case 'cipher':
            content.innerHTML = `
                <div class="cipher-game">
                    <div class="game-instruction">
                        <p>Şifrelenmiş mesajı çöz!</p>
                    </div>
                    <div class="typing-target">${gameData.encoded}</div>
                    <p style="text-align:center; color:var(--text-dim); margin:10px 0;">
                        İpucu: ${gameData.shift} pozisyon kaydırılmış
                    </p>
                    <input type="text" id="game-input" placeholder="CEVAP" style="text-transform:uppercase;" />
                    <button class="btn-primary" onclick="submitAnswer()">Gönder</button>
                </div>
            `;
            break;
        
        case 'wire':
            content.innerHTML = `
                <div class="wire-game">
                    <div class="game-instruction">
                        <p>Doğru kabloyu kes!</p>
                    </div>
                    <div class="wire-container">
                        <div class="wire red" onclick="submitWire('red')">
                            <span>✂️ KIRMIZI KABLO</span>
                        </div>
                        <div class="wire blue" onclick="submitWire('blue')">
                            <span>✂️ MAVİ KABLO</span>
                        </div>
                        <div class="wire green" onclick="submitWire('green')">
                            <span>✂️ YEŞİL KABLO</span>
                        </div>
                        <div class="wire yellow" onclick="submitWire('yellow')">
                            <span>✂️ SARI KABLO</span>
                        </div>
                    </div>
                </div>
            `;
            break;
        
        case 'typing':
            content.innerHTML = `
                <div class="typing-game">
                    <div class="game-instruction">
                        <p>Kodu hızlıca yaz!</p>
                    </div>
                    <div class="typing-target">${gameData.targetCode}</div>
                    <input type="text" id="game-input" placeholder="Buraya yaz..." />
                    <button class="btn-primary" onclick="submitAnswer()">Gönder</button>
                </div>
            `;
            break;
        
        case 'sequence':
            const buttons = gameData.numbers.map(num => 
                `<div class="sequence-cell" onclick="addToSequence(${num}, this)">${num}</div>`
            ).join('');
            content.innerHTML = `
                <div class="sequence-game">
                    <div class="game-instruction">
                        <p>Sayıları 1'den 10'a kadar sırayla tıkla!</p>
                    </div>
                    <div class="sequence-grid">
                        ${buttons}
                    </div>
                    <button class="btn-primary" onclick="submitSequence()">Gönder</button>
                </div>
            `;
            window.playerSequence = [];
            break;
        
        case 'memory':
            // Önce diziliyi göster
            content.innerHTML = `
                <div class="memory-game">
                    <div class="game-instruction">
                        <p>Dizilimi izle ve tekrarla!</p>
                    </div>
                    <div class="memory-grid" id="memory-grid">
                        ${Array(16).fill(0).map((_, i) => 
                            `<div class="memory-cell" data-index="${i}"></div>`
                        ).join('')}
                    </div>
                    <button class="btn-primary" id="memory-submit" onclick="submitMemory()" style="display:none;">Gönder</button>
                </div>
            `;
            
            // Dizilimi göster
            showMemorySequence(gameData.sequence);
            break;
    }
}

// Memory dizilim göster
function showMemorySequence(sequence) {
    const cells = document.querySelectorAll('.memory-cell');
    let delay = 500;
    
    sequence.forEach((index, i) => {
        setTimeout(() => {
            cells[index].classList.add('active');
            setTimeout(() => cells[index].classList.remove('active'), 400);
        }, delay * (i + 1));
    });
    
    setTimeout(() => {
        cells.forEach(cell => {
            cell.style.cursor = 'pointer';
            cell.onclick = () => selectMemoryCell(parseInt(cell.dataset.index), cell);
        });
        document.getElementById('memory-submit').style.display = 'block';
    }, delay * (sequence.length + 1));
    
    window.playerMemory = [];
}

function selectMemoryCell(index, cell) {
    if (cell.classList.contains('selected')) {
        cell.classList.remove('selected');
        window.playerMemory = window.playerMemory.filter(i => i !== index);
    } else {
        cell.classList.add('selected');
        window.playerMemory.push(index);
    }
}

function submitMemory() {
    const timeSpent = (Date.now() - gameStartTime) / 1000;
    socket.emit('submit-answer', {
        pin: currentPin,
        answer: window.playerMemory,
        timeSpent: timeSpent
    });
}

// Sequence işlemleri
function addToSequence(num, cell) {
    if (!cell.classList.contains('clicked')) {
        window.playerSequence.push(num);
        cell.classList.add('clicked');
        cell.style.pointerEvents = 'none';
    }
}

function submitSequence() {
    const timeSpent = (Date.now() - gameStartTime) / 1000;
    socket.emit('submit-answer', {
        pin: currentPin,
        answer: window.playerSequence,
        timeSpent: timeSpent
    });
}

// Wire cevap gönder
function submitWire(color) {
    const timeSpent = (Date.now() - gameStartTime) / 1000;
    socket.emit('submit-answer', {
        pin: currentPin,
        answer: color,
        timeSpent: timeSpent
    });
}

// Cevap gönder
function submitAnswer() {
    const input = document.getElementById('game-input');
    if (!input || !input.value.trim()) return;
    
    const timeSpent = (Date.now() - gameStartTime) / 1000;
    socket.emit('submit-answer', {
        pin: currentPin,
        answer: input.value.trim(),
        timeSpent: timeSpent
    });
}

// Cevap sonucu
socket.on('answer-result', ({ correct, score, timeBonus }) => {
    if (correct) {
        playerScore += score;
        playSound('success');
        document.getElementById('result-icon').textContent = '✓';
        document.getElementById('result-icon').style.color = 'var(--success-color)';
        document.getElementById('result-message').textContent = 'Doğru Cevap!';
        document.getElementById('earned-points').textContent = score;
    } else {
        playSound('fail');
        document.getElementById('result-icon').textContent = '✗';
        document.getElementById('result-icon').style.color = 'var(--danger-color)';
        document.getElementById('result-message').textContent = 'Yanlış Cevap';
        document.getElementById('earned-points').textContent = '0';
    }
    
    document.getElementById('total-player-score').textContent = playerScore;
    document.getElementById('player-score').textContent = playerScore;
    showScreen('player-result-screen');
});

// Oyun bitti
socket.on('game-ended', ({ scores }) => {
    const myRank = scores.findIndex(s => s.nickname === playerNickname) + 1;
    document.getElementById('final-player-score').textContent = playerScore;
    document.getElementById('final-rank').textContent = `Sıralaman: ${myRank}/${scores.length}`;
    
    const boardEl = document.getElementById('final-player-scoreboard');
    boardEl.innerHTML = '<h4>Sıralama</h4>' + scores.map((player, i) => `
        <div class="score-item ${player.nickname === playerNickname ? 'highlight' : ''}">
            <span>#${i + 1}</span>
            <span>${player.nickname}</span>
            <span>${player.score}</span>
        </div>
    `).join('');
    
    showScreen('final-screen');
});

// Host bağlantısı koptu
socket.on('host-disconnected', () => {
    alert('Host bağlantısı koptu. Ana sayfaya yönlendiriliyorsunuz.');
    location.reload();
});

// Atıldın!
socket.on('kicked', ({ message }) => {
    alert(message);
    location.reload();
});

// Yardımcı fonksiyonlar
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function showError(message) {
    const errorEl = document.getElementById('join-error');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    setTimeout(() => {
        errorEl.style.display = 'none';
    }, 3000);
}

function playSound(type) {
    const sound = document.getElementById(`${type}-sound`);
    if (sound) {
        sound.currentTime = 0;
        sound.play().catch(() => {});
    }
}

// Enter tuşu ile gönderme
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const activeScreen = document.querySelector('.screen.active');
        if (activeScreen.id === 'join-screen') {
            joinRoom();
        } else if (activeScreen.id === 'player-game-screen') {
            const input = document.getElementById('game-input');
            if (input) submitAnswer();
        }
    }
});
