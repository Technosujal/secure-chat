const socket = io();

let currentUser = '';
let currentRoom = '';
let roomAESKey = '';
let serverPublicKey = '';
let userSocketId = '';
let isTyping = false;
let typingTimeout;
let users = {};
let currentTheme = 'dark';
let userPreferences = {
    notifications: true,
    sound: true,
    showTimestamps: true,
    compactMode: false
};

// Color palette for avatars
const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];

// Add this near the top with other variables

let emojiPickerVisible = false;
const commonEmojis = ['😀', '😂', '😍', '🎉', '👍', '❤️', '🔥', '⭐', '😎', '🚀', '💯', '👏', '😢', '😡', '🤔', '😴'];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    currentUser = params.get('user') || 'User';
    currentRoom = params.get('room') || 'General';
    
    loadSettings();
    initializeTheme();
    setupEventListeners();
    setupSocketListeners();
    generateUserAvatar();
    document.getElementById('currentUserName').textContent = currentUser;
    document.getElementById('roomName').textContent = currentRoom;
});

// Generate user avatar
function generateUserAvatar() {
    const avatar = document.getElementById('userAvatar');
    const initials = currentUser.substring(0, 2).toUpperCase();
    const color = colors[hashCode(currentUser) % colors.length];
    avatar.textContent = initials;
    avatar.style.background = color;
}

// Hash function for consistent color
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

// Theme management
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    currentTheme = savedTheme;
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-mode');
        document.getElementById('themeToggle').innerHTML = '<i class="fas fa-sun"></i>';
    } else {
        document.body.classList.remove('light-mode');
        document.getElementById('themeToggle').innerHTML = '<i class="fas fa-moon"></i>';
    }
}

// Settings
function loadSettings() {
    const saved = localStorage.getItem('userPreferences');
    if (saved) {
        userPreferences = JSON.parse(saved);
    }
}

function saveSettings() {
    localStorage.setItem('userPreferences', JSON.stringify(userPreferences));
}

// Setup event listeners
function setupEventListeners() {
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', currentTheme);
        applyTheme(currentTheme);
    });

    // Message input
    const messageInput = document.getElementById('messageInput');
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
        handleTyping();
    });

    messageInput.addEventListener('input', handleTyping);

    // Send button
    document.getElementById('sendBtn').addEventListener('click', sendMessage);

    // File button
    document.getElementById('fileBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });

    document.getElementById('fileInput').addEventListener('change', handleFileShare);

    // Emoji button - FIXED
    document.getElementById('emojiBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleEmojiPicker();
    });

    // Close emoji picker when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#emojiBtn') && !e.target.closest('.emoji-picker-wrapper')) {
            closeEmojiPicker();
        }
    });

    // Settings
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('closeSettings').addEventListener('click', closeSettings);
    document.getElementById('settingsModal').addEventListener('click', (e) => {
        if (e.target.id === 'settingsModal') closeSettings();
    });

    // Info button
    document.getElementById('infoBtn').addEventListener('click', openInfo);
    document.getElementById('closeInfo').addEventListener('click', closeInfo);
    document.getElementById('infoModal').addEventListener('click', (e) => {
        if (e.target.id === 'infoModal') closeInfo();
    });

    // Settings toggles
    document.getElementById('notificationToggle').addEventListener('change', (e) => {
        userPreferences.notifications = e.target.checked;
        saveSettings();
    });

    document.getElementById('soundToggle').addEventListener('change', (e) => {
        userPreferences.sound = e.target.checked;
        saveSettings();
    });

    document.getElementById('timestampToggle').addEventListener('change', (e) => {
        userPreferences.showTimestamps = e.target.checked;
        saveSettings();
    });

    document.getElementById('compactModeToggle').addEventListener('change', (e) => {
        userPreferences.compactMode = e.target.checked;
        saveSettings();
        updateMessagesDisplay();
    });

    // Leave room
    document.getElementById('leaveBtn').addEventListener('click', () => {
        socket.emit('leave-room', { room: currentRoom, user: currentUser });
        window.location.href = '/login.html';
    });

    // User search
    document.getElementById('userSearch').addEventListener('input', filterUsers);

    // Load settings into modal
    document.getElementById('notificationToggle').checked = userPreferences.notifications;
    document.getElementById('soundToggle').checked = userPreferences.sound;
    document.getElementById('timestampToggle').checked = userPreferences.showTimestamps;
    document.getElementById('compactModeToggle').checked = userPreferences.compactMode;
}

// Typing indicator
function handleTyping() {
    if (!isTyping) {
        isTyping = true;
        socket.emit('typing', { room: currentRoom, user: currentUser });
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTyping = false;
        socket.emit('stop-typing', { room: currentRoom });
    }, 3000);
}

// File sharing
function handleFileShare(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const fileData = {
                name: file.name,
                type: file.type,
                size: file.size,
                data: event.target.result
            };
            sendMessage(`[FILE] ${file.name}`);
        };
        reader.readAsDataURL(file);
    }
}

// Emoji picker
function toggleEmojiPicker() {
    const wrapper = document.getElementById('emojiPickerWrapper');
    
    if (!emojiPickerVisible) {
        showEmojiPicker();
    } else {
        closeEmojiPicker();
    }
}

function showEmojiPicker() {
    const wrapper = document.getElementById('emojiPickerWrapper');
    wrapper.innerHTML = '';
    
    // Create emoji grid
    const grid = document.createElement('div');
    grid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        padding: 12px;
        background: var(--bg-darker);
        border-radius: 12px;
        width: 200px;
    `;
    
    commonEmojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.textContent = emoji;
        btn.style.cssText = `
            font-size: 20px;
            padding: 8px;
            border: 1px solid var(--border-dark);
            background: rgba(99, 102, 241, 0.1);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
        `;
        
        btn.addEventListener('mouseover', () => {
            btn.style.background = 'rgba(99, 102, 241, 0.2)';
            btn.style.transform = 'scale(1.2)';
        });
        
        btn.addEventListener('mouseout', () => {
            btn.style.background = 'rgba(99, 102, 241, 0.1)';
            btn.style.transform = 'scale(1)';
        });
        
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            insertEmoji(emoji);
            closeEmojiPicker();
        });
        
        grid.appendChild(btn);
    });
    
    wrapper.appendChild(grid);
    wrapper.classList.add('active');
    emojiPickerVisible = true;
}

function closeEmojiPicker() {
    const wrapper = document.getElementById('emojiPickerWrapper');
    wrapper.classList.remove('active');
    wrapper.innerHTML = '';
    emojiPickerVisible = false;
}

function insertEmoji(emoji) {
    const input = document.getElementById('messageInput');
    input.value += emoji;
    input.focus();
}

// Settings modal
function openSettings() {
    document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

// Info modal
function openInfo() {
    document.getElementById('infoModal').classList.add('active');
    document.getElementById('infoRoomName').textContent = currentRoom;
    document.getElementById('infoUserCount').textContent = Object.keys(users).length;
    document.getElementById('infoUserId').textContent = userSocketId.substring(0, 8) + '...';
}

function closeInfo() {
    document.getElementById('infoModal').classList.remove('active');
}

// Send message
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message) return;

    input.value = '';
    isTyping = false;

    try {
        // Encrypt message
        const encryptedMessage = CryptoJS.AES.encrypt(message, roomAESKey).toString();
        socket.emit('send-message', {
            room: currentRoom,
            user: currentUser,
            message: encryptedMessage,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Encryption failed:', error);
    }
}

// Display message
function displayMessage(user, message, timestamp, isOwn = false) {
    const container = document.getElementById('messagesContainer');
    const welcome = container.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    let messageGroup = container.lastElementChild;
    const isNewGroup = !messageGroup || 
                       messageGroup.querySelector('.message-author-name')?.textContent !== user ||
                       (new Date() - new Date(messageGroup.dataset.timestamp)) > 60000;

    if (isNewGroup) {
        messageGroup = document.createElement('div');
        messageGroup.className = 'message-group';
        messageGroup.dataset.timestamp = timestamp;
        container.appendChild(messageGroup);
    }

    const msgEl = document.createElement('div');
    msgEl.className = `message ${isOwn ? 'own' : ''}`;

    if (!messageGroup.querySelector('.message-author') || isNewGroup) {
        const authorEl = document.createElement('div');
        authorEl.className = 'message-author';
        authorEl.innerHTML = `
            <div class="message-avatar" style="background: ${colors[hashCode(user) % colors.length]}">
                ${user.substring(0, 2).toUpperCase()}
            </div>
            <div>
                <div class="message-author-name">${user}</div>
                <div class="message-author-time">${formatTime(timestamp)}</div>
            </div>
        `;
        messageGroup.appendChild(authorEl);
    }

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    if (message.startsWith('[FILE]')) {
        bubble.classList.add('file');
        bubble.innerHTML = `<i class="fas fa-file"></i><span>${message.substring(6)}</span>`;
    } else {
        bubble.textContent = message;
    }

    msgEl.appendChild(bubble);

    const reactionsEl = document.createElement('div');
    reactionsEl.className = 'message-reactions';
    msgEl.appendChild(reactionsEl);

    messageGroup.appendChild(msgEl);

    // Auto scroll
    container.scrollTop = container.scrollHeight;

    // Play sound
    if (userPreferences.sound && !isOwn) {
        playNotificationSound();
    }

    // Notification
    if (userPreferences.notifications && !isOwn) {
        showNotification(user, message);
    }
}

// Format time
function formatTime(timestamp) {
    if (!userPreferences.showTimestamps) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Update users list
function updateUsersList(usersList) {
    users = usersList;
    const list = document.getElementById('usersList');
    list.innerHTML = '';

    document.getElementById('userCount').textContent = Object.keys(users).length;

    Object.entries(users).forEach(([socketId, userName]) => {
        const userItem = document.createElement('div');
        userItem.className = `user-item ${userName === currentUser ? 'active' : ''}`;
        userItem.innerHTML = `
            <div class="user-item-avatar" style="background: ${colors[hashCode(userName) % colors.length]}">
                ${userName.substring(0, 2).toUpperCase()}
            </div>
            <div class="user-item-name">${userName}</div>
            <div class="user-item-status"></div>
        `;
        list.appendChild(userItem);
    });
}

// Filter users
function filterUsers(e) {
    const query = e.target.value.toLowerCase();
    const items = document.querySelectorAll('.user-item');
    items.forEach(item => {
        const name = item.querySelector('.user-item-name').textContent.toLowerCase();
        item.style.display = name.includes(query) ? 'flex' : 'none';
    });
}

// Show typing indicator
function showTypingIndicator(userName) {
    const indicator = document.getElementById('typingIndicator');
    const userSpan = document.getElementById('typingUser');
    userSpan.textContent = `${userName} is typing...`;
    indicator.classList.add('active');

    clearTimeout(indicator.timeout);
    indicator.timeout = setTimeout(() => {
        indicator.classList.remove('active');
    }, 3000);
}

// Play notification sound
function playNotificationSound() {
    const audio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==');
    audio.play().catch(() => {});
}

// Show notification
function showNotification(user, message) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`${user} in ${currentRoom}`, {
            body: message.substring(0, 100),
            icon: '/favicon.ico'
        });
    }
}

// Update messages display
function updateMessagesDisplay() {
    const messages = document.querySelectorAll('.message');
    messages.forEach(msg => {
        msg.style.opacity = userPreferences.compactMode ? '0.8' : '1';
    });
}

// Socket listeners
function setupSocketListeners() {
    socket.on('connect', () => {
        userSocketId = socket.id;
        socket.emit('join-room', { room: currentRoom, user: currentUser });
        requestNotificationPermission();
    });

    socket.on('public-key', (key) => {
        serverPublicKey = key;
        const aesKey = generateAESKey();
        roomAESKey = aesKey;

        const encrypted = RSAEncrypt(aesKey, key);
        socket.emit('encrypted-aes', { room: currentRoom, encryptedKey: encrypted });
    });

    socket.on('message', (data) => {
        try {
            const decrypted = CryptoJS.AES.decrypt(data.message, roomAESKey).toString(CryptoJS.enc.Utf8);
            displayMessage(data.user, decrypted, data.timestamp, data.user === currentUser);
        } catch (error) {
            console.error('Decryption failed:', error);
        }
    });

    socket.on('users-list', (usersList) => {
        updateUsersList(usersList);
    });

    socket.on('typing', (data) => {
        if (data.user !== currentUser) {
            showTypingIndicator(data.user);
        }
    });

    socket.on('stop-typing', () => {
        document.getElementById('typingIndicator').classList.remove('active');
    });

    socket.on('user-joined', (data) => {
        displayMessage('System', `✅ ${data.user} joined the room`, new Date().toISOString());
    });

    socket.on('user-left', (data) => {
        displayMessage('System', `👋 ${data.user} left the room`, new Date().toISOString());
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error);
        displayMessage('System', 'Connection error', new Date().toISOString());
    });
}

// Encryption helpers
function generateAESKey() {
    return CryptoJS.lib.WordArray.random(16).toString();
}

function RSAEncrypt(data, publicKey) {
    // Simple base64 encoding for demo (replace with actual RSA in production)
    return btoa(data);
}

// Request notification permission
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}