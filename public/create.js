let adminKey = '';
let questions = [];

// Key doğrula
async function verifyKey() {
    const key = document.getElementById('admin-key').value.trim();
    
    if (!key) {
        showError('Key gerekli!');
        return;
    }
    
    try {
        const response = await fetch('/api/verify-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        
        const data = await response.json();
        
        if (data.success) {
            adminKey = key;
            showScreen('creator-screen');
            addQuestion(); // İlk soruyu ekle
        } else {
            showError(data.message || 'Geçersiz key!');
        }
    } catch (error) {
        showError('Bağlantı hatası!');
    }
}

// Soru ekle
function addQuestion() {
    const questionNumber = questions.length + 1;
    const questionId = `q${questionNumber}`;
    
    questions.push({
        id: questionId,
        question: '',
        options: ['', '', '', ''],
        correctAnswer: 0,
        timeLimit: 20
    });
    
    const container = document.getElementById('questions-container');
    const questionDiv = document.createElement('div');
    questionDiv.className = 'question-card';
    questionDiv.id = questionId;
    questionDiv.innerHTML = `
        <div class="question-header">
            <h4>Soru ${questionNumber}</h4>
            <button class="btn-remove" onclick="removeQuestion('${questionId}')">✕</button>
        </div>
        
        <div class="form-section">
            <label>Soru Metni</label>
            <input type="text" class="question-input" data-id="${questionId}" placeholder="Soruyu yazın..." />
        </div>
        
        <div class="form-section">
            <label>Seçenekler</label>
            <div class="options-grid">
                ${[0, 1, 2, 3].map(i => `
                    <div class="option-item">
                        <input type="radio" name="${questionId}-correct" value="${i}" ${i === 0 ? 'checked' : ''} />
                        <input type="text" class="option-input" data-id="${questionId}" data-index="${i}" 
                               placeholder="Seçenek ${i + 1}" />
                    </div>
                `).join('')}
            </div>
            <p style="font-size:0.8em; color:var(--text-dim); margin-top:10px;">
                ⚪ = Doğru cevabı işaretleyin
            </p>
        </div>
        
        <div class="form-section">
            <label>Süre (saniye)</label>
            <input type="number" class="time-input" data-id="${questionId}" value="20" min="5" max="60" />
        </div>
    `;
    
    container.appendChild(questionDiv);
    
    // Event listeners
    questionDiv.querySelector('.question-input').addEventListener('input', updateQuestion);
    questionDiv.querySelectorAll('.option-input').forEach(input => {
        input.addEventListener('input', updateQuestion);
    });
    questionDiv.querySelectorAll(`input[name="${questionId}-correct"]`).forEach(radio => {
        radio.addEventListener('change', updateQuestion);
    });
    questionDiv.querySelector('.time-input').addEventListener('input', updateQuestion);
}

// Soru güncelle
function updateQuestion(e) {
    const questionId = e.target.dataset.id;
    const question = questions.find(q => q.id === questionId);
    if (!question) return;
    
    if (e.target.classList.contains('question-input')) {
        question.question = e.target.value;
    } else if (e.target.classList.contains('option-input')) {
        const index = parseInt(e.target.dataset.index);
        question.options[index] = e.target.value;
    } else if (e.target.classList.contains('time-input')) {
        question.timeLimit = parseInt(e.target.value) || 20;
    } else if (e.target.type === 'radio') {
        question.correctAnswer = parseInt(e.target.value);
    }
}

// Soru sil
function removeQuestion(questionId) {
    const index = questions.findIndex(q => q.id === questionId);
    if (index > -1) {
        questions.splice(index, 1);
        document.getElementById(questionId).remove();
        
        // Soru numaralarını güncelle
        questions.forEach((q, i) => {
            const oldId = q.id;
            const newId = `q${i + 1}`;
            q.id = newId;
            
            const element = document.getElementById(oldId);
            if (element) {
                element.id = newId;
                element.querySelector('h4').textContent = `Soru ${i + 1}`;
                // ID'leri güncelle
                element.querySelectorAll('[data-id]').forEach(el => {
                    el.dataset.id = newId;
                });
                element.querySelector(`input[type="radio"]`).name = newId + '-correct';
            }
        });
    }
}

// Quiz'i kaydet
async function saveQuiz() {
    const title = document.getElementById('quiz-title').value.trim();
    const description = document.getElementById('quiz-description').value.trim();
    
    if (!title) {
        alert('Quiz başlığı gerekli!');
        return;
    }
    
    if (questions.length === 0) {
        alert('En az 1 soru ekleyin!');
        return;
    }
    
    // Soruları validate et
    for (let q of questions) {
        if (!q.question) {
            alert('Tüm soruları doldurun!');
            return;
        }
        if (q.options.some(opt => !opt)) {
            alert('Tüm seçenekleri doldurun!');
            return;
        }
    }
    
    const quiz = {
        title,
        description,
        questions: questions.map(q => ({
            question: q.question,
            options: q.options,
            correctAnswer: q.correctAnswer,
            timeLimit: q.timeLimit
        }))
    };
    
    try {
        const response = await fetch('/api/save-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: adminKey, quiz })
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('quiz-info').innerHTML = `
                <div class="quiz-summary">
                    <p><strong>Quiz ID:</strong> ${data.quizId}</p>
                    <p><strong>Başlık:</strong> ${title}</p>
                    <p><strong>Soru Sayısı:</strong> ${questions.length}</p>
                    <p style="color:var(--text-dim); margin-top:15px;">
                        Bu quiz'i host panelinde seçerek oyun başlatabilirsiniz!
                    </p>
                </div>
            `;
            showScreen('success-screen');
        } else {
            alert(data.message || 'Kayıt hatası!');
        }
    } catch (error) {
        alert('Bağlantı hatası!');
    }
}

// Yeni quiz oluştur
function createAnother() {
    questions = [];
    document.getElementById('quiz-title').value = '';
    document.getElementById('quiz-description').value = '';
    document.getElementById('questions-container').innerHTML = `
        <h3>SORULAR</h3>
        <p style="color:var(--text-dim); margin-bottom:20px;">
            Her 3 doğru cevaptan sonra oyuncular ödül kazanır!
        </p>
    `;
    showScreen('creator-screen');
    addQuestion();
}

// Host paneline git
function goToHost() {
    window.location.href = '/host.html';
}

// Çıkış
function logout() {
    adminKey = '';
    showScreen('key-screen');
    document.getElementById('admin-key').value = '';
}

// Hata göster
function showError(message) {
    const errorEl = document.getElementById('key-error');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    setTimeout(() => {
        errorEl.style.display = 'none';
    }, 3000);
}

// Ekran geçişi
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

// Enter ile key doğrulama
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const activeScreen = document.querySelector('.screen.active');
        if (activeScreen && activeScreen.id === 'key-screen') {
            verifyKey();
        }
    }
});
