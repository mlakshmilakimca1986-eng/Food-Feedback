// Change this to your deployed backend API URL (e.g., "https://food-feedback-api.onrender.com/api") if hosting the API externally.
const API_BASE = "https://food-feedback.onrender.com/api";

let currentUser = null; // { email, role: 'warden' | 'agm' }
let localStudentsDB = []; // Loaded from student_data.json as fallback
let currentSelectedStudent = null;
let activeFilters = { date: '', campus: 'all', category: 'all', section: 'all' };
let currentFilteredFeedbacks = []; // Holds active feedbacks shown in the AGM dashboard

// Today's Date info
const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const todayDateObj = new Date();
const todayDateStr = todayDateObj.toISOString().split('T')[0]; // YYYY-MM-DD
const todayDayName = dayNames[todayDateObj.getDay()];

// Default Menu
let dailyMenu = {
  breakfast: "Idly, Vada, Sambar, Coconut Chutney",
  lunch: "Rice, Dal, Veg Kurma, Papad, Rasam, Curd",
  snacks: "Veg Puff, Tea / Coffee",
  dinner: "Roti, Dal Tadka, Jeera Rice, Curd"
};

// Chart instances
let performanceChartInstance = null;
let distributionChartInstance = null;

// Rating Labels mapping
const ratingLabels = {
  0: "Select Rating",
  1: "Poor",
  2: "Average",
  3: "Good",
  4: "Very Good",
  5: "Excellent"
};

// Helper to calculate average rating of a meal from its items (supporting legacy number ratings)
function getOverallMealRating(ratings, meal) {
  const mealRatingsObj = ratings[meal];
  if (!mealRatingsObj) return 0;
  if (typeof mealRatingsObj === 'number') {
    return mealRatingsObj;
  }
  const keys = Object.keys(mealRatingsObj);
  if (keys.length === 0) return 0;
  
  let sum = 0;
  let count = 0;
  keys.forEach(key => {
    const val = parseInt(mealRatingsObj[key]);
    if (val > 0) {
      sum += val;
      count++;
    }
  });
  return count > 0 ? sum / count : 0;
}

// ==========================================================================
// INITIALIZE APPLICATION
// ==========================================================================
async function initApp() {
  // Load local students database from JSON file (as silent cache/fallback)
  try {
    const res = await fetch('student_data.json');
    if (res.ok) {
      localStudentsDB = await res.json();
      console.log(`Loaded ${localStudentsDB.length} student records from student_data.json`);
    }
  } catch (err) {
    console.error("Failed to load local student_data.json fallback:", err);
  }

  // Load custom menu if saved in LocalStorage
  const savedMenu = localStorage.getItem('srichaitanya_daily_menu');
  if (savedMenu) {
    dailyMenu = JSON.parse(savedMenu);
  }
  updateMenuUI();

  // Bind UI Events
  bindUIEvents();
  
  // Set dates in Warden Feedback
  document.getElementById('feedback-date').textContent = formatDate(todayDateStr);
  document.getElementById('feedback-day').textContent = todayDayName;

  // Check if there is an active session
  checkSession();
}

// ==========================================================================
// AUTHENTICATION LOGIC (API + LOCAL FALLBACK)
// ==========================================================================
function getLocalWardens() {
  const saved = localStorage.getItem('srichaitanya_wardens_db');
  return saved ? JSON.parse(saved) : [
    { email: 'warden@srichaitanyaschool.net', password: 'Warden@123', createdAt: new Date().toISOString() }
  ];
}

function saveLocalWarden(email, password) {
  const list = getLocalWardens();
  const cleanEmail = email.toLowerCase().trim();
  if (list.some(w => w.email.toLowerCase().trim() === cleanEmail)) {
    return false; // already exists
  }
  list.push({ email: cleanEmail, password, createdAt: new Date().toISOString() });
  localStorage.setItem('srichaitanya_wardens_db', JSON.stringify(list));
  return true;
}

function checkSession() {
  const session = sessionStorage.getItem('srichaitanya_session');
  if (session) {
    const data = JSON.parse(session);
    handleUserLogin(data.email, data.role);
  } else {
    handleUserLogout();
  }
}

async function handleLogin(email, password) {
  const cleanEmail = email.toLowerCase().trim();
  
  // AGM Bypass
  if (cleanEmail === 'srinivasnaidu.m@srichaitanyaschool.net' && password === 'Admin@123') {
    sessionStorage.setItem('srichaitanya_session', JSON.stringify({ email: cleanEmail, role: 'agm' }));
    handleUserLogin(cleanEmail, 'agm');
    return;
  }

  // Check TiDB via API
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password })
    });
    
    if (res.ok) {
      const data = await res.json();
      sessionStorage.setItem('srichaitanya_session', JSON.stringify({ email: data.email, role: data.role }));
      handleUserLogin(data.email, data.role);
      return;
    } else if (res.status === 401 || res.status === 400) {
      // Strict rejection: if the database checked and rejected, do NOT fall back to local storage
      showToast("Invalid Credentials. Please check email and password.", "error");
      return;
    }
  } catch (err) {
    console.warn("API Login check failed, trying local storage check...", err);
  }

  // Fallback to local Wardens Database (Only used if server/network is completely offline)
  const localWardensList = getLocalWardens();
  const matchedLocalWarden = localWardensList.find(w => w.email.toLowerCase().trim() === cleanEmail && w.password === password);

  if (matchedLocalWarden) {
    sessionStorage.setItem('srichaitanya_session', JSON.stringify({ email: cleanEmail, role: 'warden' }));
    handleUserLogin(cleanEmail, 'warden');
  } else {
    showToast("Invalid Credentials. Please check email and password.", "error");
  }
}

function handleUserLogin(email, role) {
  currentUser = { email, role };
  
  // Show header status elements
  document.getElementById('current-user-email').textContent = email;
  document.querySelectorAll('.status-user-badge, #logout-btn').forEach(el => el.style.display = 'inline-flex');
  
  // STRICT View Swapping via inline CSS (guarantees no overlap or scrolling downwards)
  document.getElementById('login-view').style.setProperty('display', 'none', 'important');
  
  if (role === 'agm') {
    document.getElementById('agm-view').style.setProperty('display', 'block', 'important');
    document.getElementById('warden-view').style.setProperty('display', 'none', 'important');
    initAGMDashboard();
  } else {
    document.getElementById('warden-view').style.setProperty('display', 'block', 'important');
    document.getElementById('agm-view').style.setProperty('display', 'none', 'important');
    resetWardenForm();
  }
}

function handleLogoutClick() {
  sessionStorage.removeItem('srichaitanya_session');
  handleUserLogout();
}

function handleUserLogout() {
  currentUser = null;
  
  // Reset header UI elements
  document.querySelectorAll('.status-user-badge, #logout-btn').forEach(el => el.style.display = 'none');
  
  // Reset display styles to hide dashboards and reveal login card
  document.getElementById('login-view').style.setProperty('display', 'flex', 'important');
  document.getElementById('warden-view').style.setProperty('display', 'none', 'important');
  document.getElementById('agm-view').style.setProperty('display', 'none', 'important');
}

// ==========================================================================
// WARDEN WORKFLOW (STUDENT LOOKUP & SUBMISSIONS)
// ==========================================================================
function updateMenuUI() {
  document.getElementById('menu-breakfast').value = dailyMenu.breakfast;
  document.getElementById('menu-lunch').value = dailyMenu.lunch;
  document.getElementById('menu-snacks').value = dailyMenu.snacks;
  document.getElementById('menu-dinner').value = dailyMenu.dinner;

  document.getElementById('preview-breakfast').textContent = dailyMenu.breakfast || "Not configured";
  document.getElementById('preview-lunch').textContent = dailyMenu.lunch || "Not configured";
  document.getElementById('preview-snacks').textContent = dailyMenu.snacks || "Not configured";
  document.getElementById('preview-dinner').textContent = dailyMenu.dinner || "Not configured";

  generateDynamicFeedbackForm();
}

function generateDynamicFeedbackForm() {
  const meals = ['breakfast', 'lunch', 'snacks', 'dinner'];
  
  meals.forEach(meal => {
    const container = document.getElementById(`meal-body-${meal}`);
    if (!container) return;
    
    container.innerHTML = '';
    const menuText = dailyMenu[meal] || '';
    const items = menuText.split(',').map(i => i.trim()).filter(Boolean);
    const itemsToUse = items.length > 0 ? items : [meal.charAt(0).toUpperCase() + meal.slice(1)];
    
    itemsToUse.forEach(item => {
      const safeItemName = item.replace(/[^a-zA-Z0-9]/g, '_');
      const itemHTML = `
        <div class="item-feedback-subdivision" data-meal="${meal}" data-item="${item}">
          <div class="item-info-row">
            <span class="item-name"><i class="fa-solid fa-angle-right"></i> ${item}</span>
            <div class="star-rating-container">
              <div class="stars" data-meal="${meal}" data-item="${item}">
                <i class="fa-regular fa-star star-btn" data-value="1"></i>
                <i class="fa-regular fa-star star-btn" data-value="2"></i>
                <i class="fa-regular fa-star star-btn" data-value="3"></i>
                <i class="fa-regular fa-star star-btn" data-value="4"></i>
                <i class="fa-regular fa-star star-btn" data-value="5"></i>
              </div>
              <span class="rating-label" id="label-${meal}-${safeItemName}">Select Rating</span>
            </div>
          </div>
          <input type="text" class="meal-comment-input item-comment-input" id="comment-${meal}-${safeItemName}" placeholder="Any comments for ${item}? (optional)">
        </div>
      `;
      container.insertAdjacentHTML('beforeend', itemHTML);
    });
  });
}

function saveMenu() {
  dailyMenu = {
    breakfast: document.getElementById('menu-breakfast').value.trim(),
    lunch: document.getElementById('menu-lunch').value.trim(),
    snacks: document.getElementById('menu-snacks').value.trim(),
    dinner: document.getElementById('menu-dinner').value.trim()
  };
  localStorage.setItem('srichaitanya_daily_menu', JSON.stringify(dailyMenu));
  updateMenuUI();
  showToast("Daily menu updated successfully!", "success");
}

async function handleStudentLookup(scsCode) {
  scsCode = scsCode.trim();
  if (scsCode.length < 7) {
    clearStudentDetails();
    return;
  }

  const fullSCSNumber = `SCS${scsCode}`;
  let student = null;

  // 1. Try API query (queries TiDB)
  try {
    const res = await fetch(`${API_BASE}/student?scsNumber=${fullSCSNumber}`);
    if (res.ok) {
      student = await res.json();
    }
  } catch (err) {
    console.warn("API student query failed, falling back to local JSON cache...", err);
  }

  // 2. Try local JSON fallback (with load check safety net)
  if (!student) {
    if (localStudentsDB.length === 0) {
      console.log("Local database empty, attempting on-the-fly fetch...");
      try {
        const res = await fetch('student_data.json');
        if (res.ok) {
          localStudentsDB = await res.json();
        }
      } catch (err) {
        console.error("On-the-fly fetch failed:", err);
      }
    }
    student = localStudentsDB.find(s => s.scsNumber === fullSCSNumber);
  }

  const detailsBox = document.getElementById('student-details-box');
  const feedbackCard = document.getElementById('feedback-card');
  const feedbackOverlay = document.getElementById('feedback-overlay');

  if (student) {
    currentSelectedStudent = student;
    
    // Update student UI
    document.getElementById('student-display-name').textContent = student.studentName;
    document.getElementById('student-display-category').textContent = student.category || "-";
    document.getElementById('student-display-section').textContent = student.section || "-";
    document.getElementById('student-display-campus').textContent = student.campus || "-";
    
    detailsBox.className = "student-result-box found";
    detailsBox.querySelector('.empty-state').style.display = 'none';
    detailsBox.querySelector('.details-grid').style.display = 'flex';
    
    // Enable Feedback Card
    feedbackCard.classList.remove('disabled');
    feedbackOverlay.style.display = 'none';
  } else {
    currentSelectedStudent = null;
    clearStudentDetails();
    
    detailsBox.className = "student-result-box notfound";
    detailsBox.querySelector('.empty-state').innerHTML = `
      <i class="fa-solid fa-user-xmark" style="color: var(--error)"></i>
      <p style="color: var(--error)">Student code <strong>SCS${scsCode}</strong> not found.</p>
    `;
    detailsBox.querySelector('.empty-state').style.display = 'flex';
    detailsBox.querySelector('.details-grid').style.display = 'none';
    
    // Keep feedback card disabled
    feedbackCard.classList.add('disabled');
    feedbackOverlay.style.display = 'flex';
  }
}

function clearStudentDetails() {
  currentSelectedStudent = null;
  const detailsBox = document.getElementById('student-details-box');
  detailsBox.className = "student-result-box empty";
  detailsBox.querySelector('.empty-state').innerHTML = `
    <i class="fa-solid fa-magnifying-glass"></i>
    <p>Enter ID above to fetch student details</p>
  `;
  detailsBox.querySelector('.empty-state').style.display = 'flex';
  detailsBox.querySelector('.details-grid').style.display = 'none';

  // Disable Feedback Card
  const feedbackCard = document.getElementById('feedback-card');
  const feedbackOverlay = document.getElementById('feedback-overlay');
  feedbackCard.classList.add('disabled');
  feedbackOverlay.style.display = 'flex';
}

function resetWardenForm() {
  document.getElementById('student-scs-input').value = '';
  clearStudentDetails();
  resetFeedbackStars();
}

function resetFeedbackStars() {
  document.querySelectorAll('.stars').forEach(starContainer => {
    starContainer.removeAttribute('data-rating');
    starContainer.classList.remove('has-rating');
    
    starContainer.querySelectorAll('.star-btn').forEach(btn => {
      btn.className = "fa-regular fa-star star-btn";
    });
    
    const meal = starContainer.getAttribute('data-meal');
    const item = starContainer.getAttribute('data-item');
    const safeItemName = item.replace(/[^a-zA-Z0-9]/g, '_');
    const labelEl = document.getElementById(`label-${meal}-${safeItemName}`);
    if (labelEl) {
      labelEl.textContent = "Select Rating";
      labelEl.className = "rating-label";
    }
  });
  
  document.querySelectorAll('.item-comment-input').forEach(input => {
    input.value = "";
  });
}

async function handleFeedbackSubmission(e) {
  e.preventDefault();

  if (!currentSelectedStudent) {
    showToast("Error: No student record loaded.", "error");
    return;
  }

  const ratings = { breakfast: {}, lunch: {}, snacks: {}, dinner: {} };
  const comments = { breakfast: {}, lunch: {}, snacks: {}, dinner: {} };
  let atLeastOneRated = false;

  document.querySelectorAll('.stars').forEach(starContainer => {
    const meal = starContainer.getAttribute('data-meal');
    const item = starContainer.getAttribute('data-item');
    const rating = parseInt(starContainer.getAttribute('data-rating') || '0');
    
    ratings[meal][item] = rating;
    if (rating > 0) {
      atLeastOneRated = true;
    }

    const safeItemName = item.replace(/[^a-zA-Z0-9]/g, '_');
    const commentVal = document.getElementById(`comment-${meal}-${safeItemName}`).value.trim();
    comments[meal][item] = commentVal;
  });

  if (!atLeastOneRated) {
    showToast("Please select a rating for at least one item.", "warning");
    return;
  }

  // Build feedback payload
  const feedbackData = {
    scsNumber: currentSelectedStudent.scsNumber,
    studentName: currentSelectedStudent.studentName,
    category: currentSelectedStudent.category || '',
    section: currentSelectedStudent.section || '',
    campus: currentSelectedStudent.campus || '',
    date: todayDateStr,
    day: todayDayName,
    ratings: ratings,
    comments: comments,
    submittedAt: new Date().toISOString()
  };

  // 1. Save to TiDB database via API
  let savedToCloud = false;
  try {
    const res = await fetch(`${API_BASE}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedbackData)
    });
    if (res.ok) {
      savedToCloud = true;
    }
  } catch (err) {
    console.warn("API feedback submit failed, caching locally...", err);
  }

  // 2. Cache locally as fallback/history
  let localDB = localStorage.getItem('srichaitanya_feedback_db');
  let list = localDB ? JSON.parse(localDB) : [];
  list.push(feedbackData);
  localStorage.setItem('srichaitanya_feedback_db', JSON.stringify(list));
  
  if (savedToCloud) {
    showToast("Feedback submitted successfully!", "success");
  } else {
    showToast("Feedback saved locally (will sync later)!", "success");
  }
  resetWardenForm();
}

// ==========================================================================
// AGM PORTAL LOGIC (TIDB + LOCAL SYNC)
// ==========================================================================
async function initAGMDashboard() {
  activeFilters.date = todayDateStr;
  document.getElementById('filter-date').value = todayDateStr;
  
  // Set filter categories
  populateFilterOptions();
  
  // Load Warden User List
  await renderWardensList();
  
  // Query and update dashboard UI
  await refreshAGMData();
}

async function renderWardensList() {
  const tbody = document.getElementById('wardens-list-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  let wardens = [];

  // Query TiDB wardens via API
  try {
    const res = await fetch(`${API_BASE}/wardens`);
    if (res.ok) {
      wardens = await res.json();
    }
  } catch (err) {
    console.warn("API wardens fetch failed, loading local list instead...", err);
  }

  // Fallback to local storage if API was empty or failed
  if (wardens.length === 0) {
    wardens = getLocalWardens();
  }

  wardens.forEach(w => {
    const tr = document.createElement('tr');
    const creationDate = w.createdAt ? new Date(w.createdAt).toLocaleDateString() : 'System Default';
    tr.innerHTML = `
      <td><strong>${w.email}</strong></td>
      <td>${creationDate}</td>
      <td><span class="badge badge-success">Active</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function populateFilterOptions() {
  const campusSel = document.getElementById('filter-campus');
  const catSel = document.getElementById('filter-category');
  const secSel = document.getElementById('filter-section');

  const campuses = ["ECITY_GIRLS_RESIDENTIAL", "ELECTRONIC_CITY_DS", "ECITY_NEET_BOYS", "ECITY_SCHOOL", "ECITY_ENGG_GIRLS_RESIDENTIAL"];
  const categories = ["11th Class", "12th Class", "9th Class", "10th Class", "8th Class", "7th Class", "6th Class"];
  
  campusSel.innerHTML = '<option value="all">All Campuses</option>';
  catSel.innerHTML = '<option value="all">All Classes</option>';
  secSel.innerHTML = '<option value="all">All Sections</option>';

  campuses.forEach(c => {
    campusSel.innerHTML += `<option value="${c}">${c.replace(/_/g, ' ')}</option>`;
  });
  
  categories.forEach(cat => {
    catSel.innerHTML += `<option value="${cat}">${cat}</option>`;
  });

  if (localStudentsDB.length > 0) {
    const sections = [...new Set(localStudentsDB.map(s => s.section).filter(Boolean))].sort();
    sections.forEach(s => {
      secSel.innerHTML += `<option value="${s}">${s}</option>`;
    });
  }
}

async function refreshAGMData() {
  let feedbackRecords = [];

  // Query TiDB feedbacks via API
  try {
    const res = await fetch(`${API_BASE}/feedback`);
    if (res.ok) {
      feedbackRecords = await res.json();
    }
  } catch (err) {
    console.warn("API feedback query failed, using local database...", err);
  }

  // Fallback if API returned empty
  if (feedbackRecords.length === 0) {
    feedbackRecords = getLocalFeedback();
  }

  // Apply Filters
  const filteredData = feedbackRecords.filter(item => {
    if (activeFilters.date && item.date !== activeFilters.date) {
      return false;
    }
    if (activeFilters.campus !== 'all' && item.campus !== activeFilters.campus) {
      return false;
    }
    if (activeFilters.category !== 'all' && item.category !== activeFilters.category) {
      return false;
    }
    if (activeFilters.section !== 'all' && item.section !== activeFilters.section) {
      return false;
    }
    return true;
  });

  currentFilteredFeedbacks = filteredData;
  updateAnalyticsUI(filteredData);
}

function getLocalFeedback() {
  const localDB = localStorage.getItem('srichaitanya_feedback_db');
  return localDB ? JSON.parse(localDB) : [];
}

function updateAnalyticsUI(data) {
  const total = data.length;
  document.getElementById('metric-total-submissions').textContent = total;

  let sums = { breakfast: 0, lunch: 0, snacks: 0, dinner: 0 };
  let counts = { breakfast: 0, lunch: 0, snacks: 0, dinner: 0 };
  let ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  data.forEach(item => {
    const r = item.ratings || {};
    ['breakfast', 'lunch', 'snacks', 'dinner'].forEach(meal => {
      const val = getOverallMealRating(r, meal);
      if (val > 0) {
        sums[meal] += val;
        counts[meal]++;
        const roundedVal = Math.round(val);
        if (ratingCounts[roundedVal] !== undefined) {
          ratingCounts[roundedVal]++;
        }
      }
    });
  });

  const avgs = {};
  ['breakfast', 'lunch', 'snacks', 'dinner'].forEach(meal => {
    avgs[meal] = counts[meal] > 0 ? (sums[meal] / counts[meal]).toFixed(1) : "0.0";
    document.getElementById(`metric-${meal}-avg`).innerHTML = `
      ${avgs[meal]} <span class="metric-stars"><i class="fa-solid fa-star"></i></span>
    `;
  });

  drawPerformanceChart(avgs);
  drawDistributionChart(ratingCounts);
  renderFeedbackTable(data);
}

function renderFeedbackTable(data) {
  const tbody = document.getElementById('feedback-table-body');
  const searchInput = document.getElementById('log-search-input').value.toLowerCase().trim();
  
  const searchedData = data.filter(item => {
    if (!searchInput) return true;
    const name = (item.studentName || '').toLowerCase();
    const scs = (item.scsNumber || '').toLowerCase();
    return name.includes(searchInput) || scs.includes(searchInput);
  });

  if (searchedData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center text-muted py-4">No records match the active search or filters.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  searchedData.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  searchedData.forEach(item => {
    const tr = document.createElement('tr');
    const time = item.submittedAt ? new Date(item.submittedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
    const dateStr = item.date ? formatDate(item.date) : '';
    
    tr.innerHTML = `
      <td><strong>${dateStr}</strong> <br><small class="text-muted">${time}</small></td>
      <td><span class="badge badge-warning" style="font-size:11px;">${item.scsNumber}</span></td>
      <td><strong>${item.studentName}</strong></td>
      <td>${item.category || '-'}<br><small class="text-muted">${item.section || '-'}</small></td>
      <td><small>${(item.campus || '-').replace(/_/g, ' ')}</small></td>
      <td>${getMealRatingHTML(item.ratings.breakfast, item.comments.breakfast)}</td>
      <td>${getMealRatingHTML(item.ratings.lunch, item.comments.lunch)}</td>
      <td>${getMealRatingHTML(item.ratings.snacks, item.comments.snacks)}</td>
      <td>${getMealRatingHTML(item.ratings.dinner, item.comments.dinner)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function getMealRatingHTML(mealRatingsObj, mealCommentsObj) {
  if (!mealRatingsObj) {
    return `<span class="text-muted">-</span>`;
  }
  
  // Legacy check
  if (typeof mealRatingsObj === 'number') {
    if (mealRatingsObj === 0) return `<span class="text-muted">-</span>`;
    let stars = '';
    for (let i = 1; i <= 5; i++) {
      stars += i <= mealRatingsObj ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
    }
    let commentHTML = '';
    if (mealCommentsObj && typeof mealCommentsObj === 'string') {
      commentHTML = `
        <div class="table-comment" title="${mealCommentsObj}">
          <i class="fa-regular fa-comment-dots"></i> ${mealCommentsObj}
        </div>
      `;
    }
    return `
      <div class="table-meal-rating">
        <span class="table-stars">${stars}</span>
        ${commentHTML}
      </div>
    `;
  }
  
  // Subdivision Object breakdown
  const keys = Object.keys(mealRatingsObj);
  if (keys.length === 0) {
    return `<span class="text-muted">-</span>`;
  }
  
  let html = '<div class="table-meal-items-breakdown">';
  let ratedCount = 0;
  
  keys.forEach(item => {
    const rating = parseInt(mealRatingsObj[item] || '0');
    if (rating === 0) return;
    ratedCount++;
    
    let stars = '';
    for (let i = 1; i <= 5; i++) {
      stars += i <= rating ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
    }
    
    const comment = mealCommentsObj ? (mealCommentsObj[item] || '') : '';
    let commentHTML = '';
    if (comment) {
      commentHTML = `<span class="item-breakdown-comment" title="${comment}"><i class="fa-regular fa-comment-dots"></i></span>`;
    }
    
    html += `
      <div class="item-breakdown-row">
        <span class="item-breakdown-name" title="${item}">${item}:</span>
        <span class="table-stars">${stars}</span>
        ${commentHTML}
      </div>
    `;
  });
  
  html += '</div>';
  
  return ratedCount > 0 ? html : `<span class="text-muted">-</span>`;
}

function drawPerformanceChart(avgs) {
  const ctx = document.getElementById('meal-performance-chart').getContext('2d');
  if (performanceChartInstance) {
    performanceChartInstance.destroy();
  }

  performanceChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Breakfast', 'Lunch', 'Snacks', 'Dinner'],
      datasets: [{
        label: 'Average Score',
        data: [parseFloat(avgs.breakfast), parseFloat(avgs.lunch), parseFloat(avgs.snacks), parseFloat(avgs.dinner)],
        backgroundColor: [
          'rgba(217, 119, 6, 0.7)',
          'rgba(202, 138, 4, 0.7)',
          'rgba(124, 58, 237, 0.7)',
          'rgba(13, 148, 136, 0.7)'
        ],
        borderColor: ['#d97706', '#ca8a04', '#7c3aed', '#0d9488'],
        borderWidth: 2,
        borderRadius: 8,
        barPercentage: 0.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { min: 0, max: 5, ticks: { stepSize: 1 } } }
    }
  });
}

function drawDistributionChart(ratingCounts) {
  const ctx = document.getElementById('rating-distribution-chart').getContext('2d');
  if (distributionChartInstance) {
    distributionChartInstance.destroy();
  }

  const labels = ['1 Star (Poor)', '2 Stars (Average)', '3 Stars (Good)', '4 Stars (Very Good)', '5 Stars (Excellent)'];
  const colors = ['#ef4444', '#f97316', '#eab308', '#3b82f6', '#10b981'];

  distributionChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: [ratingCounts[1], ratingCounts[2], ratingCounts[3], ratingCounts[4], ratingCounts[5]],
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } }
      },
      cutout: '60%'
    }
  });
}

function getMealCSVRatingString(mealObj) {
  if (!mealObj) return '0';
  if (typeof mealObj === 'number') return mealObj;
  return Object.keys(mealObj)
    .map(item => `${item}: ${mealObj[item]}`)
    .join(" | ");
}

function getMealCSVCommentString(commentObj) {
  if (!commentObj) return '';
  if (typeof commentObj === 'string') return commentObj;
  return Object.keys(commentObj)
    .map(item => `${item}: ${commentObj[item]}`)
    .filter(str => !str.endsWith(": ")) // filter out empty comments
    .join(" | ");
}

function exportFeedbackToCSV() {
  const feedbackList = currentFilteredFeedbacks.length > 0 ? currentFilteredFeedbacks : getLocalFeedback();

  if (feedbackList.length === 0) {
    showToast("No feedback records available to export.", "warning");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Date,Day,SCS ID,Student Name,Class,Section,Campus,Breakfast Rating,Breakfast Comment,Lunch Rating,Lunch Comment,Snacks Rating,Snacks Comment,Dinner Rating,Dinner Comment,Submitted At\n";

  feedbackList.forEach(item => {
    const row = [
      item.date || '',
      item.day || '',
      item.scsNumber || '',
      `"${(item.studentName || '').replace(/"/g, '""')}"`,
      `"${(item.category || '')}"`,
      `"${(item.section || '')}"`,
      `"${(item.campus || '')}"`,
      `"${getMealCSVRatingString(item.ratings.breakfast)}"`,
      `"${(getMealCSVCommentString(item.comments.breakfast)).replace(/"/g, '""')}"`,
      `"${getMealCSVRatingString(item.ratings.lunch)}"`,
      `"${(getMealCSVCommentString(item.comments.lunch)).replace(/"/g, '""')}"`,
      `"${getMealCSVRatingString(item.ratings.snacks)}"`,
      `"${(getMealCSVCommentString(item.comments.snacks)).replace(/"/g, '""')}"`,
      `"${getMealCSVRatingString(item.ratings.dinner)}"`,
      `"${(getMealCSVCommentString(item.comments.dinner)).replace(/"/g, '""')}"`,
      item.submittedAt || ''
    ];
    csvContent += row.join(",") + "\n";
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `SriChaitanya_FoodFeedback_Report_${todayDateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("CSV report exported successfully!", "success");
}

function generateDemoFeedback() {
  if (localStudentsDB.length === 0) {
    showToast("Error: Student records load in progress, retry in a second.", "error");
    return;
  }
  
  const commentsPool = {
    1: ["Food was cold", "Not cooked properly", "Spicy", "Very disappointed"],
    2: ["Needs more salt", "Average taste", "No enough quantity", "Sambar was average"],
    3: ["Good taste", "Okay food", "Sufficient quantity", "Fine"],
    4: ["Very tasty today", "Perfect salt & spices", "Chutney was very good", "Appreciated"],
    5: ["Excellent meal", "Loved the special roti", "Top notch cooking", "Samosa was awesome!"]
  };

  const generatedList = [];

  for (let i = 0; i < 25; i++) {
    const student = localStudentsDB[Math.floor(Math.random() * localStudentsDB.length)];
    const ratings = {};
    const comments = {};

    ['breakfast', 'lunch', 'snacks', 'dinner'].forEach(meal => {
      ratings[meal] = {};
      comments[meal] = {};
      
      const menuText = dailyMenu[meal] || '';
      const items = menuText.split(',').map(idx => idx.trim()).filter(Boolean);
      const itemsToUse = items.length > 0 ? items : [meal.charAt(0).toUpperCase() + meal.slice(1)];
      
      itemsToUse.forEach(item => {
        const rating = Math.floor(Math.random() * 5) + 1;
        ratings[meal][item] = rating;
        
        if (Math.random() < 0.3) {
          const pool = commentsPool[rating];
          comments[meal][item] = pool[Math.floor(Math.random() * pool.length)];
        } else {
          comments[meal][item] = "";
        }
      });
    });

    const dateOffset = Math.floor(Math.random() * 3);
    const tempDate = new Date();
    tempDate.setDate(tempDate.getDate() - dateOffset);
    const dateStr = tempDate.toISOString().split('T')[0];
    const dayNameStr = dayNames[tempDate.getDay()];

    const mockObj = {
      scsNumber: student.scsNumber,
      studentName: student.studentName,
      category: student.category || '',
      section: student.section || '',
      campus: student.campus || '',
      date: dateStr,
      day: dayNameStr,
      ratings: ratings,
      comments: comments,
      submittedAt: tempDate.toISOString()
    };

    generatedList.push(mockObj);
  }

  let localDB = localStorage.getItem('srichaitanya_feedback_db');
  let list = localDB ? JSON.parse(localDB) : [];
  list.push(...generatedList);
  localStorage.setItem('srichaitanya_feedback_db', JSON.stringify(list));

  showToast("Demo feedback data generated successfully!", "success");
  refreshAGMData();
}

// ==========================================================================
// BIND EVENTS & UTILITIES
// ==========================================================================
function bindUIEvents() {
  // Login Form
  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    handleLogin(email, pass);
  });

  // Toggle Password Visiblity
  document.getElementById('toggle-pwd').addEventListener('click', () => {
    const pwdInput = document.getElementById('login-password');
    const eyeIcon = document.getElementById('toggle-pwd').querySelector('i');
    if (pwdInput.type === 'password') {
      pwdInput.type = 'text';
      eyeIcon.className = "fa-regular fa-eye-slash";
    } else {
      pwdInput.type = 'password';
      eyeIcon.className = "fa-regular fa-eye";
    }
  });

  // Logout Button
  document.getElementById('logout-btn').addEventListener('click', handleLogoutClick);

  // Collapsible Menu setup
  document.getElementById('menu-toggle-header').addEventListener('click', () => {
    const card = document.querySelector('.menu-setup-card');
    card.classList.toggle('collapsed');
  });

  // Menu Save
  document.getElementById('save-menu-btn').addEventListener('click', saveMenu);

  // Student Search input keypress lookup
  const searchInput = document.getElementById('student-scs-input');
  searchInput.addEventListener('input', (e) => {
    const rawVal = e.target.value.replace(/\D/g, ''); // Extract numeric digits only
    e.target.value = rawVal;
    
    if (rawVal.length === 7 || rawVal.length === 8) {
      handleStudentLookup(rawVal);
    } else {
      clearStudentDetails();
    }
  });

  // Star Rating clicks binding
  // Star Rating clicks delegation for dynamic stars
  document.getElementById('feedback-submission-form').addEventListener('click', (e) => {
    const btn = e.target.closest('.star-btn');
    if (!btn) return;
    
    const value = parseInt(btn.getAttribute('data-value'));
    const container = btn.parentElement;
    const meal = container.getAttribute('data-meal');
    const item = container.getAttribute('data-item');
    const safeItemName = item.replace(/[^a-zA-Z0-9]/g, '_');
    
    container.setAttribute('data-rating', value);
    container.classList.add('has-rating');

    container.querySelectorAll('.star-btn').forEach((star, index) => {
      if (index < value) {
        star.className = "fa-solid fa-star star-btn active";
      } else {
        star.className = "fa-regular fa-star star-btn";
      }
    });

    const label = document.getElementById(`label-${meal}-${safeItemName}`);
    if (label) {
      label.textContent = ratingLabels[value];
      label.className = "rating-label active";
    }
  });

  // Clear Form Button
  document.getElementById('clear-feedback-btn').addEventListener('click', () => {
    resetFeedbackStars();
  });

  // Submit Feedback Form
  document.getElementById('feedback-submission-form').addEventListener('submit', handleFeedbackSubmission);

  // AGM Filters
  document.getElementById('filter-date').addEventListener('change', (e) => {
    activeFilters.date = e.target.value;
    refreshAGMData();
  });
  document.getElementById('filter-campus').addEventListener('change', (e) => {
    activeFilters.campus = e.target.value;
    refreshAGMData();
  });
  document.getElementById('filter-category').addEventListener('change', (e) => {
    activeFilters.category = e.target.value;
    refreshAGMData();
  });
  document.getElementById('filter-section').addEventListener('change', (e) => {
    activeFilters.section = e.target.value;
    refreshAGMData();
  });
  
  // Table search
  document.getElementById('log-search-input').addEventListener('input', () => {
    refreshAGMData();
  });

  // Reset filters button
  document.getElementById('reset-filters-btn').addEventListener('click', () => {
    document.getElementById('filter-date').value = todayDateStr;
    document.getElementById('filter-campus').value = 'all';
    document.getElementById('filter-category').value = 'all';
    document.getElementById('filter-section').value = 'all';
    document.getElementById('log-search-input').value = '';
    
    activeFilters = { date: todayDateStr, campus: 'all', category: 'all', section: 'all' };
    refreshAGMData();
  });

  // Generate Mock feedback button
  document.getElementById('btn-mock-data').addEventListener('click', generateDemoFeedback);

  // Export CSV
  document.getElementById('export-csv-btn').addEventListener('click', exportFeedbackToCSV);

  // Warden User Creation Form submission
  document.getElementById('create-warden-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('warden-email-input').value.toLowerCase().trim();
    const password = document.getElementById('warden-password-input').value;
    
    if (password.length < 6) {
      showToast("Password must be at least 6 characters.", "warning");
      return;
    }

    let apiSuccess = false;
    try {
      const res = await fetch(`${API_BASE}/warden`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (res.ok) {
        apiSuccess = true;
      }
    } catch (err) {
      console.error("Warden creation API failed:", err);
    }

    const success = saveLocalWarden(email, password);

    if (success || apiSuccess) {
      showToast("Warden account created successfully!", "success");
      document.getElementById('warden-email-input').value = '';
      document.getElementById('warden-password-input').value = '';
      await renderWardensList();
    } else {
      showToast("Account already exists.", "error");
    }
  });
}

// Utility: Toast notifications
function showToast(message, type = "info") {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-xmark';
  if (type === 'warning') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3500);
}

// Utility: Format date YYYY-MM-DD to DD/MM/YYYY
function formatDate(dateString) {
  if (!dateString) return '';
  const parts = dateString.split('-');
  if (parts.length !== 3) return dateString;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// Run Initialization
window.addEventListener('DOMContentLoaded', initApp);
