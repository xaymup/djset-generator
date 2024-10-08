// Spotify API credentials
const clientId = '1b977c733d7548bc8d906aa088094e49';
const redirectUri = 'https://xaymup.me/djset-generator/';
// const redirectUri = 'http://localhost:5500'; 
let accessToken;
let genreList = []; // Array to hold genre objects from genres.json

function init() {
    const args = new URLSearchParams(window.location.hash.substr(1));
    accessToken = args.get('access_token');

    if (accessToken) {
        document.getElementById('login-button').style.display = 'none';
        document.getElementById('email-form').style.display = 'none';
        document.getElementById('dj-set-form').style.display = 'block';
        tokenExpire(redirectUri);
    } else {
        document.getElementById('login-button').style.display = 'block';
        document.getElementById('email-form').style.display = 'block';
        document.getElementById('dj-set-form').style.display = 'none';
    }
}

function tokenExpire(url) {
    // 3600 seconds = 3600 * 1000 milliseconds
    setTimeout(function() {
        window.location.href = url;
    }, 3600 * 1000);
}

function authenticate() {
    const scopes = 'user-read-private user-read-email playlist-modify-private';
    window.location = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
}

// Function to search for tracks
async function searchTracks(query, limit = 50, type = 'track') {
    query = query.replace(/ /g, "-");
    if (!query.includes(':')) {
        query = "tag:" + query;
    }
    const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.tracks.items;
}


async function getAudioFeatures(trackIds) {
    const features = [];
    const chunkSize = 50; // Spotify API limit for batch requests
    for (let i = 0; i < trackIds.length; i += chunkSize) {
        const chunk = trackIds.slice(i, i + chunkSize);
        const response = await fetch(`https://api.spotify.com/v1/audio-features?ids=${chunk.join(',')}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        features.push(...data.audio_features);
    }
    return features;
}

// Helper function to check if BPMs are mixable
function areBPMsMixable(bpm1, bpm2) {
    const ratio = bpm1 / bpm2;
    const acceptableRatios = [0.5, 0.75, 1, 1.33, 1.5, 2];
    return acceptableRatios.some(r => Math.abs(ratio - r) < 0.02);
}

const pitchClassToCamelot = {
    0: ["8B", "5A"],  // C major, A minor
    1: ["3B", "12A"], // C♯ major, B♭ minor
    2: ["10B", "7A"], // D major, B minor
    3: ["5B", "2A"],  // E♭ major, C minor
    4: ["12B", "9A"], // E major, C♯ minor
    5: ["7B", "4A"],  // F major, D minor
    6: ["2B", "11A"], // F♯ major, E♭ minor
    7: ["9B", "6A"],  // G major, E minor
    8: ["4B", "1A"],  // A♭ major, F minor
    9: ["11B", "8A"], // A major, F♯ minor
    10: ["6B", "3A"], // B♭ major, G minor
    11: ["1B", "10A"] // B major, G♯ minor
};

function getCamelotNotation(key, mode) {
    // Convert Spotify key and mode to pitch class
    const pitchClass = key;  // Spotify's key is already in the range of 0-11
    const isMajor = mode === 1;  // Spotify's mode: 1 = major, 0 = minor

    // Return the appropriate Camelot notation
    return isMajor ? pitchClassToCamelot[pitchClass][0] : pitchClassToCamelot[pitchClass][1];
}

function areCamelotNotationsMixable(camelot1, camelot2) {
    const camelotMap = {
        '1A': 0, '1B': 1, '2A': 2, '2B': 3, '3A': 4, '3B': 5,
        '4A': 6, '4B': 7, '5A': 8, '5B': 9, '6A': 10, '6B': 11,
        '7A': 12, '7B': 13, '8A': 14, '8B': 15, '9A': 16, '9B': 17,
        '10A': 18, '10B': 19, '11A': 20, '11B': 21, '12A': 22, '12B': 23
    };

    const adjacentKeys = [1, 11]; // Keys are adjacent or a perfect fifth apart on the Camelot wheel

    function getCamelotIndex(camelot) {
        return camelotMap[camelot];
    }

    function areAdjacentOrFifthApart(index1, index2) {
        const diff = Math.abs(index1 - index2);
        return adjacentKeys.includes(diff) || diff === 6; // 6 is a perfect fifth
    }

    const index1 = getCamelotIndex(camelot1);
    const index2 = getCamelotIndex(camelot2);

    if (index1 === undefined || index2 === undefined) {
        throw new Error("Invalid Camelot notation");
    }

    return areAdjacentOrFifthApart(index1, index2);
}


// Function to shuffle an array
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Function to create the DJ set
async function createDjSet(tags, durationMs, energyOption, harmonicOption) {
    let allTracks = [];
    for (const tag of tags) {
        try {
            const tracks = await searchTracks(`${tag}`);
            allTracks = allTracks.concat(tracks);
        } catch (error) {
            console.error(`Error searching for tracks with tag "${tag}":`, error);
        }
    }

    if (allTracks.length === 0) {
        throw new Error('No tracks found for the given tags');
    }

    const trackIds = allTracks.map(track => track.id);
    let audioFeatures;
    try {
        audioFeatures = await getAudioFeatures(trackIds);
    } catch (error) {
        console.error('Error getting audio features:', error);
        throw new Error(`Failed to get audio features: ${error.message}`);
    }

    let trackInfo = allTracks.map((track, index) => ({
        id: track.id,
        name: track.name,
        artist: track.artists[0].name,
        duration_ms: track.duration_ms,
        ...(audioFeatures[index] || {})
    }));

    // Sort tracks by energy if required
    if (energyOption !== 'Unsorted') {
        trackInfo.sort((a, b) => energyOption === 'Ascending' ? a.energy - b.energy : b.energy - a.energy);
    } else {
        trackInfo = shuffleArray(trackInfo);
    }



    let playlist = [];
    let currentDuration = 0;
    let lastBPM = null;
    let lastCamelot = null;

    for (const track of trackInfo) {
        if (currentDuration + track.duration_ms <= durationMs) {
            if (lastBPM === null || areBPMsMixable(lastBPM, track.tempo)) {
                if (harmonicOption.checked){
                    if (lastCamelot === null || areCamelotNotationsMixable(lastCamelot,getCamelotNotation(track.key,track.mode))){
                        if (!playlist.includes(track)) {
                            playlist.push(track);
                            currentDuration += track.duration_ms;
                            lastCamelot = getCamelotNotation(track.key,track.mode);
                            lastBPM = track.tempo;
                        }
                    }
                }
                else {
                    if (!playlist.includes(track)) {
                        playlist.push(track);
                        currentDuration += track.duration_ms;
                        lastBPM = track.tempo;
                    }
                }
            }
        } else {
            // Check if we can adjust the last track to fit the duration
            const excessDuration = currentDuration + track.duration_ms - durationMs;
            if (excessDuration < track.duration_ms) {
                playlist.push({ ...track, duration_ms: track.duration_ms - excessDuration });
                currentDuration = durationMs;
                break;
            }
        }
    }


    if (playlist.length === 0) {
        throw new Error('Could not create a playlist with the given criteria');
    }

    return playlist;
}

// Function to display the playlist
function displayPlaylist(playlist) {
    const playlistContainer = document.getElementById('playlist-container');
    playlistContainer.style.display = 'block';
    playlistContainer.innerHTML = '<legend>Your DJ set:</legend>';
    const ul = document.createElement('ul');
    let totalDurationMs = 0;

    playlist.forEach(track => {
        const li = document.createElement('li');
        const minutes = Math.floor(track.duration_ms / 60000);
        const seconds = Math.floor((track.duration_ms % 60000) / 1000);
        totalDurationMs += track.duration_ms;
        li.textContent = `${track.name} by ${track.artist} - BPM: ${track.tempo.toFixed(0)}, Camelot: ${getCamelotNotation(track.key,track.mode)}, Energy: ${track.energy.toFixed(2)}, Length: ${minutes}:${seconds.toString().padStart(2, '0')}`;
        ul.appendChild(li);
    });

    playlistContainer.appendChild(ul);

    // Calculate the total duration
    const totalMinutes = Math.floor(totalDurationMs / 60000);
    const totalSeconds = Math.floor((totalDurationMs % 60000) / 1000);

    // Display the total length of the DJ set
    const totalLength = document.createElement('p');
    totalLength.textContent = `Total Length: ${totalMinutes}:${totalSeconds.toString().padStart(2, '0')}`;
    playlistContainer.appendChild(totalLength);

    // Create the "Create Spotify Playlist" button
    const createPlaylistButton = document.createElement('button');
    createPlaylistButton.textContent = 'Create Spotify Playlist';
    createPlaylistButton.addEventListener('click', () => createSpotifyPlaylist(playlist));
    playlistContainer.appendChild(createPlaylistButton);
}

// Function to create Spotify playlist
async function createSpotifyPlaylist(playlist) {
    const userId = await getUserId();
    const playlistId = await createPlaylist(userId, 'Generated Mix');
    await addTracksToPlaylist(playlistId, playlist.map(track => track.uri));
    alert('Playlist created successfully!');
}

// Function to get user ID
async function getUserId() {
    const response = await fetch('https://api.spotify.com/v1/me', {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.id;
}

// Function to create a playlist
async function createPlaylist(userId, name) {
    const response = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: name,
            description: "Generated using https://xaymup.me/djset-generator",
            public: false
        })
    });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.id;
}

// Function to add tracks to a playlist
async function addTracksToPlaylist(playlistId, trackUris) {
    const chunkSize = 100; // Spotify API limit for batch requests
    for (let i = 0; i < trackUris.length; i += chunkSize) {
        const chunk = trackUris.slice(i, i + chunkSize);
        const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uris: chunk
            })
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
    }
}

// Event listener for form submission
document.getElementById('dj-set-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const tags = document.getElementById('tags').value.split(',').map(tag => tag.trim());
    const durationMs = document.getElementById('duration').value * 60 * 1000;
    const energyOption = document.getElementById('energy').value;
    const harmonicOption = document.getElementById('harmonic');

    
    const generateButton = document.getElementById('generate-button');
    generateButton.textContent = 'Loading...';
    generateButton.disabled = true;

    try {
        const playlist = await createDjSet(tags, durationMs, energyOption, harmonicOption);
        displayPlaylist(playlist);
    } catch (error) {
        console.error('Error creating DJ set:', error);
        alert(`An error occurred while creating the DJ set: ${error.message}`);
    } finally {
        generateButton.textContent = 'Generate Playlist';
        generateButton.disabled = false;
    }
});

// Add event listener for login button
document.getElementById('login-button').addEventListener('click', authenticate);

// Initialize the app
init();


function increment() {
    var input = document.getElementById("duration");
    var currentValue = parseInt(input.value, 10);
    var maxValue = parseInt(input.max, 10);
    if (!isNaN(currentValue) && currentValue < maxValue) {
        input.value = currentValue + 1;
    }
}

function decrement() {
    var input = document.getElementById("duration");
    var currentValue = parseInt(input.value, 10);
    var minValue = parseInt(input.min, 10);
    if (!isNaN(currentValue) && currentValue > minValue) {
        input.value = currentValue - 1;
    }
}

// Ensure input value is within bounds on manual input
document.getElementById("duration").addEventListener("change", function() {
    var value = parseInt(this.value, 10);
    var minValue = parseInt(this.min, 10);
    var maxValue = parseInt(this.max, 10);

    if (isNaN(value)) {
        this.value = minValue;
    } else if (value < minValue) {
        this.value = minValue;
    } else if (value > maxValue) {
        this.value = maxValue;
    }
});
