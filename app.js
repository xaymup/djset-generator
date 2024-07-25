const clientId = '1b977c733d7548bc8d906aa088094e49';
const redirectUri = 'http://localhost:5500'; 

let accessToken;

function init() {
    const args = new URLSearchParams(window.location.hash.substr(1));
    accessToken = args.get('access_token');

    if (accessToken) {
        document.getElementById('login-button').style.display = 'none';
        document.getElementById('dj-set-form').style.display = 'block';
    } else {
        document.getElementById('login-button').style.display = 'block';
        document.getElementById('dj-set-form').style.display = 'none';
    }
}

function authenticate() {
    const scopes = 'user-read-private user-read-email playlist-modify-private';
    window.location = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
}

async function searchTracks(query, limit = 50) {
    const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`, {
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
    const audioFeatures = [];
    for (let i = 0; i < trackIds.length; i += 100) {
        const batch = trackIds.slice(i, i + 100);
        const response = await fetch(`https://api.spotify.com/v1/audio-features?ids=${batch.join(',')}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        audioFeatures.push(...data.audio_features);

        // Implement a delay between batches to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return audioFeatures;
}

function areBPMsMixable(bpm1, bpm2) {
    const ratio = bpm1 / bpm2;
    const acceptableRatios = [0.5, 0.75, 1, 1.33, 1.5, 2];
    return acceptableRatios.some(r => Math.abs(ratio - r) < 0.02);
}

async function createDjSet(tags, durationMs, energyAscending) {
    let allTracks = [];
    for (const tag of tags) {
        try {
            const tracks = await searchTracks(tag);
            allTracks = allTracks.concat(tracks);
        } catch (error) {
            console.error(`Error searching for tracks with tag "${tag}":`, error);
            throw new Error(`Failed to search for tracks: ${error.message}`);
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

    trackInfo.sort((a, b) => energyAscending ? a.energy - b.energy : b.energy - a.energy);

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
            break;
        }
    }

    if (playlist.length === 0) {
        throw new Error('Could not create a playlist with the given criteria');
    }

    return playlist;
}

function displayPlaylist(playlist) {
    const playlistContainer = document.getElementById('playlist-container');
    playlistContainer.innerHTML = '<h2>Your DJ Set:</h2>';

    const ul = document.createElement('ul');
    playlist.forEach(track => {
        const li = document.createElement('li');
        li.textContent = `${track.name} by ${track.artist} - BPM: ${track.tempo.toFixed(0)}, Key: ${track.key}, Energy: ${track.energy.toFixed(2)}`;
        ul.appendChild(li);
    });

    playlistContainer.appendChild(ul);
}

document.getElementById('dj-set-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tags = document.getElementById('tags').value.split(',').map(tag => tag.trim());
    const durationMs = document.getElementById('duration').value * 60 * 1000;
    const energyAscending = document.getElementById('energy').value === 'ascending';

    const generateButton = document.getElementById('generate-button');
    generateButton.textContent = 'Loading...';
    generateButton.disabled = true;

    try {
        const playlist = await createDjSet(tags, durationMs, energyAscending);
        displayPlaylist(playlist);
    } catch (error) {
        console.error('Error creating DJ set:', error);
        alert(`An error occurred while creating the DJ set: ${error.message}`);
    } finally {
        generateButton.textContent = 'Generate DJ Set';
        generateButton.disabled = false;
    }
});

document.getElementById('login-button').addEventListener('click', authenticate);

init();
