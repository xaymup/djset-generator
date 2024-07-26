// Spotify API credentials
const clientId = '1b977c733d7548bc8d906aa088094e49';
const redirectUri = 'http://localhost:5500'; // Update this with your actual local server address

let accessToken;
let genreList = []; // Array to hold genre objects from genres.json

function init() {
    const args = new URLSearchParams(window.location.hash.substr(1));
    accessToken = args.get('access_token');

    if (accessToken) {
        document.getElementById('login-button').style.display = 'none';
        document.getElementById('dj-set-form').style.display = 'block';
        loadGenres(); // Load genres when the user is authenticated
    } else {
        document.getElementById('login-button').style.display = 'block';
        document.getElementById('dj-set-form').style.display = 'none';
    }
}

function authenticate() {
    const scopes = 'user-read-private user-read-email playlist-modify-private';
    window.location = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
}

// Function to load genres from JSON file
async function loadGenres() {
    try {
        const response = await fetch('genres.json');
        if (!response.ok) {
            throw new Error('Failed to load genres');
        }
        const data = await response.json();
        genreList = data.map(genre => genre.name.toLowerCase()); // Store genre names in lowercase
    } catch (error) {
        console.error('Error loading genres:', error);
    }
}

// Function to search for tracks
async function searchTracks(query, limit = 50, type = 'track') {
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

// Function to search for recommendations based on artist
async function searchRecommendations(artistId, limit = 50) {
    const response = await fetch(`https://api.spotify.com/v1/recommendations?seed_artists=${artistId}&limit=${limit}`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.tracks;
}

// Function to get artist ID by name
async function getArtistId(artistName) {
    const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.artists.items.length ? data.artists.items[0].id : null;
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

// Function to shuffle an array
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Function to create the DJ set
async function createDjSet(tags, durationMs, energyOption) {
    let allTracks = [];

    for (const tag of tags) {
        let isGenre = genreList.includes(tag.toLowerCase());
        let artistId = null;

        if (!isGenre) {
            try {
                artistId = await getArtistId(tag);
            } catch (error) {
                console.error(`Error getting artist ID for "${tag}":`, error);
            }
        }

        if (isGenre) {
            try {
                let genreTag = tag.replace(/ /g, '-');
                const tracks = await searchTracks(`genre:${genreTag}`);
                allTracks = allTracks.concat(tracks);
            } catch (error) {
                console.error(`Error searching for tracks with genre "${tag}":`, error);
            }
        } else if (artistId) {
            try {
                const tracks = await searchRecommendations(artistId);
                allTracks = allTracks.concat(tracks);
            } catch (error) {
                console.error(`Error searching for recommendations for artist "${tag}":`, error);
            }
        } else {
            try {
                const tracks = await searchTracks(`tag:${tag}`);
                allTracks = allTracks.concat(tracks);
            } catch (error) {
                console.error(`Error searching for tracks with tag "${tag}":`, error);
            }
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
    if (energyOption !== 'ignore') {
        trackInfo.sort((a, b) => energyOption === 'ascending' ? a.energy - b.energy : b.energy - a.energy);
    } else {
        trackInfo = shuffleArray(trackInfo);
    }

    let playlist = [];
    let currentDuration = 0;
    let lastBPM = null;

    for (const track of trackInfo) {
        if (currentDuration + track.duration_ms <= durationMs) {
            if (lastBPM === null || areBPMsMixable(lastBPM, track.tempo)) {
                playlist.push(track);
                currentDuration += track.duration_ms;
                lastBPM = track.tempo;
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

    // If the playlist is shorter than the desired duration, add more tracks if possible
    if (currentDuration < durationMs) {
        for (const track of trackInfo) {
            if (!playlist.includes(track) && currentDuration + track.duration_ms <= durationMs) {
                if (lastBPM === null || areBPMsMixable(lastBPM, track.tempo)) {
                    playlist.push(track);
                    currentDuration += track.duration_ms;
                    lastBPM = track.tempo;
                }
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
    playlistContainer.innerHTML = '<h2>Your DJ Set:</h2>';

    const ul = document.createElement('ul');
    let totalDurationMs = 0;

    playlist.forEach(track => {
        const li = document.createElement('li');
        const minutes = Math.floor(track.duration_ms / 60000);
        const seconds = Math.floor((track.duration_ms % 60000) / 1000);
        totalDurationMs += track.duration_ms;
        li.textContent = `${track.name} by ${track.artist} - BPM: ${track.tempo.toFixed(0)}, Key: ${track.key}, Energy: ${track.energy.toFixed(2)}, Length: ${minutes}:${seconds.toString().padStart(2, '0')}`;
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
}

// Event listener for form submission
document.getElementById('dj-set-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const tags = document.getElementById('tags').value.split(',').map(tag => tag.trim());
    const durationMs = document.getElementById('duration').value * 60 * 1000;
    const energyOption = document.querySelector('input[name="energy-option"]:checked').value;
    
    const generateButton = document.getElementById('generate-button');
    generateButton.textContent = 'Loading...';
    generateButton.disabled = true;

    try {
        const playlist = await createDjSet(tags, durationMs, energyOption);
        displayPlaylist(playlist);
    } catch (error) {
        console.error('Error creating DJ set:', error);
        alert(`An error occurred while creating the DJ set: ${error.message}`);
    } finally {
        generateButton.textContent = 'Generate DJ Set';
        generateButton.disabled = false;
    }
});

// Add event listener for login button
document.getElementById('login-button').addEventListener('click', authenticate);

// Initialize the app
init();
