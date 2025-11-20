// Global variables
let trialData = [];
let currentTrialIndex = 0;
let currentTrial = null;
let revealedWords = new Set();
let startTime = null;
let clickTimes = [];
let randomSeed = null;
let trialPoints = 100; // Points per trial (resets each trial)
let pointsPerReveal = 0; // Calculated based on revealable words in current trial
let numRevealableWords = 0; // Number of words that can be revealed in current trial
let completedTrials = []; // Store completed trial data

// Articles that should not be obscured
const articles = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];

// Get URL parameters
function getURLParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// Seeded random number generator (for reproducible randomization)
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }
    
    // Linear congruential generator
    next() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }
    
    // Shuffle array using Fisher-Yates with seeded random
    shuffle(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
}

// Determine which sublist to use based on URL parameter
const sublistParam = getURLParameter('sublist');
let sublistNumber = 1; // default

if (sublistParam) {
    const parsed = parseInt(sublistParam);
    if (parsed >= 1 && parsed <= 4) {
        sublistNumber = parsed;
    } else {
        console.warn(`Invalid sublist parameter: ${sublistParam}. Using default sublist 1.`);
    }
}

// Get random seed from URL parameter (for trial randomization)
const seedParam = getURLParameter('seed');
if (seedParam) {
    randomSeed = parseInt(seedParam);
    if (isNaN(randomSeed)) {
        // If seed is not a number, convert string to number
        randomSeed = seedParam.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    }
} else {
    // Generate random seed if not provided
    randomSeed = Math.floor(Math.random() * 1000000);
}

console.log(`Using sublist: ${sublistNumber}`);
console.log(`Using random seed: ${randomSeed}`);

const csvFilename = `trial_list_sublist_${sublistNumber}.csv`;

// Initialize jsPsych
const jsPsych = initJsPsych({});

// Initialize filename based on subjCode, sublist, and seed
const subjCode = getURLParameter('subjCode');
const filename = `${subjCode}.csv`;

// Function to update points display
function updatePointsDisplay(points) {
    const pointsElement = document.getElementById('points-counter');
    if (pointsElement) {
        pointsElement.textContent = `Trial Points: ${Math.round(points)}`;
        // Add visual feedback for point loss
        pointsElement.style.color = '#d32f2f';
        setTimeout(() => {
            pointsElement.style.color = '#333';
        }, 300);
    }
}

// Function to tokenize sentence into words and punctuation
function tokenizeSentence(sentence) {
    // Split on spaces and punctuation, keeping punctuation as separate tokens
    const tokens = [];
    const words = sentence.split(' ');
    
    words.forEach(word => {
        // Match word and trailing punctuation separately
        const match = word.match(/^([^.,!?;:'"]*)([.,!?;:'"]*)$/);
        if (match) {
            const [, wordPart, punctPart] = match;
            if (wordPart) tokens.push(wordPart);
            if (punctPart) {
                // Add each punctuation mark as separate token
                punctPart.split('').forEach(p => tokens.push(p));
            }
        } else {
            tokens.push(word);
        }
    });
    
    return tokens;
}

// Function to find target word index in tokenized sentence
function findTargetWordIndex(tokens, targetWord, targetWordPosition) {
    const cleanTarget = targetWord.toLowerCase().replace(/[.,!?;:'"]/g, '');
    
    // If targetWordPosition is provided and valid, use it to find the nth word token
    if (targetWordPosition !== null && targetWordPosition !== undefined && targetWordPosition !== '') {
        const posNum = typeof targetWordPosition === 'string' ? parseInt(targetWordPosition) : targetWordPosition;
        
        if (!isNaN(posNum) && posNum >= 0) {
            let wordCount = 0;
            for (let i = 0; i < tokens.length; i++) {
                // Skip punctuation tokens
                if (!/^[.,!?;:'"]$/.test(tokens[i])) {
                    if (wordCount === posNum) {
                        return i;
                    }
                    wordCount++;
                }
            }
            console.warn(`Could not find word at position ${posNum}, falling back to text search`);
        }
    }
    
    // Fall back to searching for the target word by text
    for (let i = 0; i < tokens.length; i++) {
        // Skip punctuation tokens
        if (!/^[.,!?;:'"]$/.test(tokens[i])) {
            const cleanToken = tokens[i].toLowerCase().replace(/[.,!?;:'"]/g, '');
            if (cleanToken === cleanTarget) {
                return i;
            }
        }
    }
    
    console.error(`Could not find target word '${targetWord}' in sentence`);
    return -1;
}

// Function to count revealable words in a trial
function countRevealableWords(jabberTokens, realTokens, targetIndex) {
    let count = 0;
    
    for (let index = 0; index < jabberTokens.length; index++) {
        const token = jabberTokens[index];
        
        // Skip punctuation
        if (/^[.,!?;:'"]$/.test(token)) {
            continue;
        }
        
        // Skip target word
        if (index === targetIndex) {
            continue;
        }
        
        const cleanJabber = token.toLowerCase().replace(/[.,!?;:'"]/g, '');
        const cleanReal = index < realTokens.length ? realTokens[index].toLowerCase().replace(/[.,!?;:'"]/g, '') : '';
        
        // Skip articles and words that are the same in both versions
        if (articles.includes(cleanJabber) || articles.includes(cleanReal) || cleanJabber === cleanReal) {
            continue;
        }
        
        // This is a revealable word
        count++;
    }
    
    return count;
}

// Function to load and randomize CSV data
function loadTrialData() {
    return new Promise((resolve, reject) => {
        Papa.parse(csvFilename, {
            download: true,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: function(results) {
                console.log('Loaded CSV data:', results.data);
                
                if (results.data.length === 0) {
                    reject(new Error('CSV file is empty'));
                    return;
                }
                
                const requiredColumns = ['passage_variant', 'jabber_passage', 'target_word'];
                const firstRow = results.data[0];
                const missingColumns = requiredColumns.filter(col => !(col in firstRow));
                
                if (missingColumns.length > 0) {
                    reject(new Error(`Missing required columns: ${missingColumns.join(', ')}`));
                    return;
                }
                
                // Store original data
                const originalData = results.data;
                
                // Randomize trial order using seeded random
                const rng = new SeededRandom(randomSeed);
                trialData = rng.shuffle(originalData);
                
                console.log(`Successfully loaded ${trialData.length} trials from sublist ${sublistNumber}`);
                console.log(`Randomized with seed ${randomSeed}`);
                
                // Log first few for debugging
                console.log('First trial structure:', trialData[0]);
                
                resolve();
            },
            error: function(error) {
                console.error('Error loading CSV:', error);
                reject(error);
            }
        });
    });
}

// Function to create word reveal trial
function createWordRevealTrial(trialIndex) {
    const trial = trialData[trialIndex];
    
    // Parse the passages
    const realSentence = trial.passage_variant || trial.ground_truth_sentence || '';
    const jabberSentence = trial.jabber_passage || trial.nonsense_sentence || '';
    
    // Tokenize sentences (separating words and punctuation)
    const realTokens = tokenizeSentence(realSentence);
    const jabberTokens = tokenizeSentence(jabberSentence);
    
    // Get target word and find its position
    const targetWord = trial.target_word;
    const targetWordPosition = trial.target_word_position; // Added by preprocessing script
    
    const targetIndex = findTargetWordIndex(jabberTokens, targetWord, targetWordPosition);
    
    const trialNumber = trialIndex + 1;
    const originalTrialNumber = trial.trial_number || trialNumber;
    
    // Validation
    if (targetIndex < 0 || targetIndex >= jabberTokens.length) {
        console.error(`Invalid target index ${targetIndex} for trial ${originalTrialNumber}`);
    }
    
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: function() {
            currentTrial = trial;
            revealedWords.clear();
            startTime = Date.now();
            clickTimes = [];
            
            // Reset points for this trial - MUST be in stimulus function so it runs each time
            trialPoints = 100;
            
            // Count revealable words and calculate points per reveal for THIS trial
            numRevealableWords = countRevealableWords(jabberTokens, realTokens, targetIndex);
            
            // Calculate points per reveal (100 / number of revealable words)
            // Round to 2 decimal places for cleaner display
            pointsPerReveal = numRevealableWords > 0 ? Math.round((100 / numRevealableWords) * 100) / 100 : 0;
            
            console.log(`Trial ${trialNumber}: ${numRevealableWords} revealable words, ${pointsPerReveal} points per reveal`);
            
            let html = `
                <div style="position: relative;">
                    <div class="trial-counter">Trial ${trialNumber} of ${trialData.length}</div>
                    <div class="points-counter" id="points-counter">Trial Points: ${trialPoints}</div>
                    <div class="sentence-container" id="sentence-container">
            `;
            
            // Build sentence token by token
            for (let index = 0; index < jabberTokens.length; index++) {
                const token = jabberTokens[index];
                
                // Check if this token is punctuation
                if (/^[.,!?;:'"]$/.test(token)) {
                    // Punctuation - just display it without any special styling
                    html += token;
                    // Add space after certain punctuation
                    if (/[.,!?;:]/.test(token) && index < jabberTokens.length - 1) {
                        html += ' ';
                    }
                    continue;
                }
                
                let wordClass = 'word';
                let displayWord = token;
                
                // Clean token for comparison
                const cleanJabber = token.toLowerCase().replace(/[.,!?;:'"]/g, '');
                const cleanReal = index < realTokens.length ? realTokens[index].toLowerCase().replace(/[.,!?;:'"]/g, '') : '';
                
                if (index === targetIndex) {
                    // This is the target word
                    wordClass += ' target';
                    displayWord = token;
                } else if (articles.includes(cleanJabber) || articles.includes(cleanReal)) {
                    // This is an article - show the real word
                    wordClass += ' article';
                    displayWord = realTokens[index];
                } else if (cleanJabber === cleanReal) {
                    // Word is the same in both - show real
                    wordClass += ' article';
                    displayWord = realTokens[index];
                } else {
                    // Regular word - can be clicked to reveal
                    wordClass += ' clickable';
                    displayWord = token;
                }
                
                html += `<span class="${wordClass}" data-index="${index}">${displayWord}</span>`;
            }
            
            html += `
                </div>
                <div class="controls">
                    <button class="guess-button" id="guess-btn">Make Guess</button>
                </div>
                </div>
            `;
            
            return html;
        },
        choices: ['Make Guess'],
        button_html: '<button class="jspsych-btn" style="display: none;">%choice%</button>',
        on_load: function() {
            const words = document.querySelectorAll('.word.clickable');
            words.forEach(word => {
                word.addEventListener('click', function() {
                    const index = parseInt(this.dataset.index);
                    if (!revealedWords.has(index)) {
                        revealedWords.add(index);
                        
                        // Deduct points proportionally
                        trialPoints -= pointsPerReveal;
                        // Ensure points don't go below 0
                        trialPoints = Math.max(0, trialPoints);
                        updatePointsDisplay(trialPoints);
                        
                        clickTimes.push({
                            word_index: index,
                            revealed_word: realTokens[index],
                            time_from_start: Date.now() - startTime
                        });
                        
                        this.textContent = realTokens[index];
                        this.classList.remove('clickable');
                        this.classList.add('revealed');
                    }
                });
            });
            
            document.getElementById('guess-btn').addEventListener('click', function() {
                // Filter out punctuation from revealed words
                const revealedWordsList = Array.from(revealedWords)
                    .filter(idx => !/^[.,!?;:'"]$/.test(realTokens[idx]))
                    .map(idx => realTokens[idx]);
                
                // Store word-reveal data in completedTrials array
                completedTrials[trialIndex] = {
                    trial_number: trialNumber,
                    subjCode: subjCode,
                    sublist: sublistNumber,
                    random_seed: randomSeed,
                    target_word: trial.target_word,
                    target_word_position: trial.target_word_position || targetIndex,
                    entropy: trial.entropy,
                    target_probability: trial.target_probability,
                    jabber_sentence: jabberSentence,
                    real_sentence: realSentence,
                    num_words_revealed: revealedWordsList.length,
                    num_revealable_words: numRevealableWords,
                    points_per_reveal: pointsPerReveal,
                    revealed_words: JSON.stringify(revealedWordsList),
                    revealed_word_indices: JSON.stringify(Array.from(revealedWords)),
                    click_times: JSON.stringify(clickTimes),
                    total_time_before_guess: Date.now() - startTime,
                    points_remaining: Math.round(trialPoints * 100) / 100, // Round to 2 decimal places
                };
                
                jsPsych.finishTrial();
            });
        },
        trial_duration: null,
        response_ends_trial: false
    };
}

// Function to create guess input trial
function createGuessInputTrial(trialIndex) {
    const trial = trialData[trialIndex];
    const trialNumber = trialIndex + 1;
    
    return {
        type: jsPsychSurveyText,
        questions: [
            {
                prompt: `<div class="instructions">
                    <p>What do you think the <strong>bolded word</strong> was in the sentence?</p>
                    <p>Type your guess below:</p>
                </div>`,
                name: 'target_word_guess',
                required: true,
                rows: 1,
                columns: 40
            }
        ],
        on_finish: function(data) {
            const guess = data.response.target_word_guess.toLowerCase().trim().replace(/[.,!?]/g, '');
            const correct = trial.target_word.toLowerCase().trim().replace(/[.,!?]/g, '');
            const isCorrect = guess === correct;
            
            // Add guess data to completedTrials
            if (completedTrials[trialIndex]) {
                completedTrials[trialIndex].guess = data.response.target_word_guess;
                completedTrials[trialIndex].guess_correct = isCorrect;
                completedTrials[trialIndex].rt_guess = data.rt;
            }
        }
    };
}

// Function to create confidence rating trial
function createConfidenceRatingTrial(trialIndex) {
    const trial = trialData[trialIndex];
    const trialNumber = trialIndex + 1;
    const originalTrialNumber = trial.trial_number || trialNumber;
    
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `
            <div style="text-align: center;">
                <p>How confident are you that you guessed the bolded word correctly?</p>
            </div>
        `,
        choices: ['1<br>Not at all confident', '2<br>Slightly confident', '3<br>Moderately confident', '4<br>Very confident', '5<br>Extremely confident'],
        button_html: '<button class="jspsych-btn" style="margin: 10px; padding: 15px 25px; font-size: 16px;">%choice%</button>',
        on_finish: function(data) {
            // Add confidence data to the stored trial object
            completedTrials[trialIndex].confidence_rating = data.response + 1; // Convert 0-4 to 1-5
            completedTrials[trialIndex].rt_confidence = data.rt;
            
            // REPLACE all data properties with our completedTrials data
            // First, get the keys from our completed trial
            const trialData = completedTrials[trialIndex];
            
            // Clear existing data properties (except internal jsPsych ones)
            const internalKeys = ['trial_type', 'trial_index', 'time_elapsed', 'internal_node_id'];
            for (let key in data) {
                if (!internalKeys.includes(key)) {
                    delete data[key];
                }
            }
            
            // Now add our custom data
            for (let key in trialData) {
                data[key] = trialData[key];
            }
        }
    };
}

// Function to create feedback trial showing the correct answer
function createFeedbackTrial(trialIndex) {
    const trial = trialData[trialIndex];
    
    return {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
            const targetWord = trial.target_word;
            return `
                <div style="text-align: center; max-width: 600px; margin: 0 auto; padding: 40px;">
                    <h2>Great job!</h2>
                    <p style="font-size: 18px; margin: 30px 0;">The target word was:</p>
                    <p style="font-size: 36px; font-weight: bold; margin: 30px 0;">${targetWord}</p>
                    <p style="margin-top: 40px; font-size: 14px; color: #666;"><em>Press any key to continue</em></p>
                </div>
            `;
        },
        trial_duration: null
    };
}

// Welcome screen
const welcome = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">
            <p>In this experiment, you will see sentences with made-up nonsense words.</p>
            <p>Your task is to:</p>
            <ul>
                <li>Click on words to reveal their true meaning -- try not to click on too many!</li>
                <li>Try to figure out what the <strong>bolded word</strong> means</li>
                <li>Make your best guess when you're ready</li>
            </ul>
            <p><strong>Scoring:</strong> Each trial starts with <strong>100 points</strong>. Each word you reveal will cost you points. Try to guess with as few reveals as possible!</p>
            <p><em>Press any key to continue</em></p>
        </div>
    `
};

// Instructions
const examples_page1 = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">
            <h2>When are you ready to guess?</h2>
            
            <p><strong>Do not guess the word if you have no idea what it might mean.</strong></p>
            
            <p>For example:</p>
            
            <p style="margin-left: 20px; font-style: italic;">
                "The glorp tafed in the deng zirp <strong>glosh</strong>."
            </p>
            
            <p>You might think that the target word is an object, but this is not a specific enough guess.</p>
            
            <p>Let's reveal some more words!</p>
            
            <p style="margin-left: 20px; font-style: italic;">
                "The glorp gleamed in the deng morning <strong>glosh</strong>."
            </p>
            
            <p>Now you might have some better guesses about what <strong>glosh</strong> could be! Is it maybe sun? sunshine? air? light? </p>
            <p> <strong>This is the right level of specificity for your guess. </strong></p>
            
            <p style="margin-top: 30px;"><em>Press any key to continue</em></p>
        </div>
    `
};

const examples_page2 = {
    type: jsPsychHtmlKeyboardResponse,
    choices: ['q'],
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">

            <p>However! You might not be able to get this close every time:<p>
                        
            <p>Sometimes, your best guess might just be that it's an animal, a color, a type of plant, etc. These are okay guesses, though they are not as good as the earlier ones.</p>

            <p>You should be able to narrow down the meaning more than just what part of speech it might be, or that it might be an object that moves. </p>
            
            <p><strong>Try and get as close as you can without losing too many points. We are looking for one word answers. </strong> </p>
            
            <p style="margin-top: 30px;"><em>Please let the experimenter know when you are ready to begin.</em></p>
        </div>
    `
};

const start_study = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">
            <h2>Press Any Key to Start Experiment</h2>
        </div>
    `
};

// Create timeline
async function createTimeline() {
    await loadTrialData();
    
    let timeline = [welcome, examples_page1, examples_page2, start_study];
    
    // Add trials for each sentence (now in randomized order)
    for (let i = 0; i < trialData.length; i++) {
        timeline.push(createWordRevealTrial(i));
        timeline.push(createGuessInputTrial(i));
        timeline.push(createConfidenceRatingTrial(i));
        timeline.push(createFeedbackTrial(i));
    }
    
    // Calculate total score across all trials
    let totalScore = 0;
    
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: '',
        trial_duration: 1,
        on_start: function() {
            // Calculate total score from all trials
            totalScore = completedTrials.reduce((sum, trial) => {
                return sum + (trial ? Math.round(trial.points_remaining) : 0);
            }, 0);
            
            jsPsych.data.addProperties({
                experiment_version: '2.0_proportional',
                sublist: sublistNumber,
                random_seed: randomSeed,
                subjCode: subjCode,
                total_score: totalScore,
                completion_time: new Date().toISOString()
            });
        }
    });
    
    // Write completedTrials to jsPsych data store with total_score
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: '',
        trial_duration: 1,
        on_start: function() {
            // Add total score to each completed trial
            completedTrials.forEach(trial => {
                if (trial) {
                    trial.total_score = totalScore;
                    trial.completion_time = new Date().toISOString();
                }
            });
            console.log('Added total_score to completedTrials:', totalScore);
        }
    });
    
    // Add data saving trial using jsPsychPipe
    const save_data = {
        type: jsPsychPipe,
        action: "save",
        experiment_id: "6sUXv8MJL3e6",
        filename: filename,
        data_string: () => {
            // Use jsPsych's built-in CSV generation but only for confidence trials
            // which now have all the combined data
            const allData = jsPsych.data.get();
            const confidenceData = allData.filter({trial_type: 'html-button-response'});
            
            console.log('Filtering to confidence trials');
            console.log('Total trials:', allData.count());
            console.log('Confidence trials:', confidenceData.count());
            
            // Log the first confidence trial to see what columns it has
            if (confidenceData.count() > 0) {
                const firstTrial = confidenceData.values()[0];
                console.log('First confidence trial columns:', Object.keys(firstTrial));
                console.log('First confidence trial data:', firstTrial);
            }
            
            const csvString = confidenceData.csv();
            console.log('CSV first 1000 chars:', csvString.substring(0, 1000));
            
            return csvString;
        },
        on_finish: function(data) {
            console.log('Save trial finished');
            console.log('Save trial data:', data);
            if (data.success === false) {
                console.error('Upload failed!', data);
            } else {
                console.log('Upload successful!');
            }
        }
    };
    
    timeline.push(save_data);
    
    // Thank you message with survey link and total score
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
            // Get survey URL from URL parameter or use default
            const surveyURL = getURLParameter('survey_url') || 'https://uwmadison.co1.qualtrics.com/jfe/form/SV_0VC8tugavHYnhoa';
            // Add subjCode to survey URL
            const surveyWithId = `${surveyURL}${surveyURL.includes('?') ? '&' : '?'}subjCode=${subjCode}`;
            
            const maxPossibleScore = trialData.length * 100;
            const scorePercentage = Math.round((totalScore / maxPossibleScore) * 100);
            
            return `
                <div style="text-align: center;">
                    <h2>Thank you and great job!</h2>
                    <p>You have completed the experiment.</p>
                    <p><strong>Total Score: ${totalScore} / ${maxPossibleScore} points (${scorePercentage}%)</strong></p>
                    <p>Your data has been saved.</p>
                    <p>Please click the link below to complete a brief survey:</p>
                    <p style="margin-top: 30px;">
                        <a href="${surveyWithId}" target="_blank" style="font-size: 18px; padding: 15px 30px; background-color: #2196f3; color: white; text-decoration: none; border-radius: 5px; display: inline-block;">
                            Go to Survey
                        </a>
                    </p>
                    <p style="margin-top: 30px; font-size: 14px; color: #666;">
                        Press any key after completing the survey to close this window.
                    </p>
                </div>
            `;
        }
    });
    
    return timeline;
}

// Run the experiment
createTimeline().then(timeline => {
    jsPsych.run(timeline);
}).catch(error => {
    console.error('Error loading experiment:', error);
    document.body.innerHTML = `
        <div style="text-align: center; padding: 50px;">
            <h2>Error Loading Experiment</h2>
            <p>Could not load trial list for sublist ${sublistNumber}.</p>
            <p>Please make sure the file ${csvFilename} exists.</p>
            <p>Error: ${error.message}</p>
        </div>
    `;
});
