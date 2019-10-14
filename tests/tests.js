// Copyright 2019 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const flaskServerUrl = 'http://localhost:5000/';
const dashManifestUrl = flaskServerUrl + 'output_files/dash.mpd';
const hlsManifestUrl = flaskServerUrl + 'output_files/hls.m3u8';
const TEST_DIR = 'test_assets/';
let player;
let video;

async function startStreamer(inputConfig, pipelineConfig) {
  // Send a request to flask server to start Shaka Streamer.
  const response = await fetch(flaskServerUrl + 'start', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
    },
    body: JSON.stringify({
      'input_config': inputConfig,
      'pipeline_config': pipelineConfig
    }),
  });

  // We use status code 418 for specially-formatted config errors.
  if (response.status == 418) {
    const error = await response.json();
    throw error;
  }

  if (!response.ok) {
    // For anything else, log the full text and fail with an error containing
    // the status code.
    console.log(response.status, response.statusText, await response.text());
    throw new Error('Failed to produce manifest: HTTP ' + response.status);
  }
}

async function stopStreamer() {
  // Send a request to flask server to stop Shaka Streamer.
  const response = await fetch(flaskServerUrl + 'stop');
  if (!response.ok) {
    throw new Error('Failed to close Shaka Streamer');
  }
}

describe('Shaka Streamer', () => {
  beforeAll(() => {
    shaka.polyfill.installAll();
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 400 * 1000;
  });

  beforeEach(() => {
    video = document.createElement('video');
    video.muted = true;
    document.body.appendChild(video);

    player = new shaka.Player(video);
    player.addEventListener('error', (error) => {
      fail(error);
    });
  });

  afterEach(async () => {
    await player.destroy();
    await stopStreamer();
    document.body.removeChild(video);
  });

  errorTests();

  resolutionTests(hlsManifestUrl, '(hls)');
  resolutionTests(dashManifestUrl, '(dash)');

  liveTests(hlsManifestUrl, '(hls)');
  liveTests(dashManifestUrl, '(dash)');

  drmTests(hlsManifestUrl, '(hls)');
  drmTests(dashManifestUrl, '(dash)');

  codecTests(hlsManifestUrl, '(hls)');
  codecTests(dashManifestUrl, '(dash)');

  autoLanguageTests(hlsManifestUrl, '(hls)');
  autoLanguageTests(dashManifestUrl, '(dash)');

  languageTests(hlsManifestUrl, '(hls)');
  languageTests(dashManifestUrl, '(dash)');

  // TODO: Test is commented out until Packager outputs codecs for vtt in mp4.
  // textTracksTests(hlsManifestUrl, '(hls)');
  textTracksTests(dashManifestUrl, '(dash)');

  vodTests(hlsManifestUrl, '(hls)');
  vodTests(dashManifestUrl, '(dash)');

  channelsTests(hlsManifestUrl, 2, '(hls)');
  channelsTests(dashManifestUrl, 2, '(dash)');
  channelsTests(hlsManifestUrl, 6, '(hls)');
  channelsTests(dashManifestUrl, 6, '(dash)');

  // The HLS manifest does not indicate the availability window, so only test
  // this in DASH.
  availabilityTests(dashManifestUrl, '(dash)');

  // The HLS manifest does not indicate the presentation delay, so only test
  // this in DASH.
  delayTests(dashManifestUrl, '(dash)');

  // The HLS manifest does not indicate the update period, so only test this in
  // DASH.
  updateTests(dashManifestUrl, '(dash)');

  durationTests(hlsManifestUrl, '(hls)');
  durationTests(dashManifestUrl, '(dash)');

  mapTests(hlsManifestUrl, '(hls)');
  mapTests(dashManifestUrl, '(dash)');

  // The player doesn't have any framerate or other metadata from an HLS
  // manifest that would let us detect our filters, so only test this in DASH.
  filterTests(dashManifestUrl, '(dash)');
});

function errorTests() {
  function getBasicInputConfig() {
    // Return a standard input config that each test can change and break
    // without repeating everything.
    return {
      inputs: [
        {
          name: TEST_DIR + 'BigBuckBunny.1080p.mp4',
          media_type: 'video',
          frame_rate: 24.0,
          resolution: '1080p',
          track_num: 0,
        },
      ],
    };
  }

  const minimalPipelineConfig = {
    streaming_mode: 'vod',
  };

  it('fails when extra fields are present', async () => {
    const inputConfig = getBasicInputConfig();
    inputConfig.inputs[0].foo = 'bar';

    await expectAsync(startStreamer(inputConfig, minimalPipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'UnrecognizedField',
          field_name: 'foo',
        }));
  });

  it('fails when media_type is missing', async () => {
    const inputConfig = getBasicInputConfig();
    delete inputConfig.inputs[0].media_type;

    await expectAsync(startStreamer(inputConfig, minimalPipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'MissingRequiredField',
          field_name: 'media_type',
        }));
  });

  it('fails when resolution is missing for video', async () => {
    const inputConfig = getBasicInputConfig();
    delete inputConfig.inputs[0].resolution;

    await expectAsync(startStreamer(inputConfig, minimalPipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'MissingRequiredField',
          field_name: 'resolution',
        }));
  });

  it('fails when frame_rate is not a number', async () => {
    const inputConfig = getBasicInputConfig();
    inputConfig.inputs[0].frame_rate = '99';

    await expectAsync(startStreamer(inputConfig, minimalPipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'WrongType',
          field_name: 'frame_rate',
        }));
  });

  it('fails when resolution is unrecognized', async () => {
    const inputConfig = getBasicInputConfig();
    inputConfig.inputs[0].resolution = 'wee';

    await expectAsync(startStreamer(inputConfig, minimalPipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'WrongType',
          field_name: 'resolution',
        }));
  });

  it('fails when track_num is not an int', async () => {
    const inputConfig = getBasicInputConfig();
    inputConfig.inputs[0].track_num = 1.1;

    await expectAsync(startStreamer(inputConfig, minimalPipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'WrongType',
          field_name: 'track_num',
        }));
  });

  it('fails when start_time/end_time used with non-file inputs', async () => {
    const inputConfig = getBasicInputConfig();
    inputConfig.inputs[0].input_type = 'raw_images'
    inputConfig.inputs[0].start_time = '0:30'

    await expectAsync(startStreamer(inputConfig, minimalPipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'MalformedField',
          field_name: 'start_time',
        }));

    delete inputConfig.inputs[0].start_time
    inputConfig.inputs[0].end_time = '0:90'

    await expectAsync(startStreamer(inputConfig, minimalPipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'MalformedField',
          field_name: 'end_time',
        }));
  });

  it('fails when filters is not a list of strings', async () => {
    const inputConfig = getBasicInputConfig();
    inputConfig.inputs[0].filters = 'foo';

    await expectAsync(startStreamer(inputConfig, minimalPipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'WrongType',
          field_name: 'filters',
        }));

    inputConfig.inputs[0].filters = [1, 2, 3];

    await expectAsync(startStreamer(inputConfig, minimalPipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'WrongType',
          field_name: 'filters',
        }));
  });

  it('fails when segment_per_file is false for live', async () => {
    const inputConfig = getBasicInputConfig();
    const pipelineConfig = {
      streaming_mode: 'live',
      segment_per_file: false,
    };

    await expectAsync(startStreamer(inputConfig, pipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'MalformedField',
          field_name: 'segment_per_file',
        }));
  });

  it('fails when content_id is not a hex string', async () => {
    const inputConfig = getBasicInputConfig();
    const pipelineConfig = {
      streaming_mode: 'vod',
      encryption: {
        enable: true,
        content_id: 'foo',
      },
    };

    await expectAsync(startStreamer(inputConfig, pipelineConfig))
        .toBeRejectedWith(jasmine.objectContaining({
          error_type: 'MalformedField',
          field_name: 'content_id',
        }));
  });
}

function resolutionTests(manifestUrl, format) {
  it('has output resolutions matching the resolutions in config ' + format,
      async () => {
    const inputConfigDict = {
      'inputs': [
        {
          'name': TEST_DIR + 'BigBuckBunny.1080p.mp4',
          'media_type': 'video',
          'frame_rate': 24.0,
          'resolution': '1080p',
          'track_num': 0,
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
      ]
    };
    const pipelineConfigDict = {
      'streaming_mode': 'vod',
      // A list of resolutions to encode.
      'resolutions': [
        '4k',
        '1080p',
        '720p',
        '480p',
        '240p',
        '144p',
      ],
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);

    const trackList = player.getVariantTracks();
    const heightList = trackList.map(track => track.height);
    heightList.sort((a, b) => a - b);
    // No 4k, since that is above the input res.
    expect(heightList).toEqual([144, 240, 480, 720, 1080]);
  });
}

function liveTests(manifestUrl, format) {
  it('has a live streaming mode ' + format, async () => {
    const inputConfigDict = {
      'inputs': [
        {
          'input_type': 'looped_file',
          'name': TEST_DIR + 'BigBuckBunny.1080p.mp4',
          'media_type': 'video',
          'frame_rate': 24.0,
          'resolution': '1080p',
          'track_num': 0,
        },
      ]
    };
    const pipelineConfigDict = {
      'streaming_mode': 'live',
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);
    expect(player.isLive()).toBe(true);
  });
}

function drmTests(manifestUrl, format) {
  it('has encryption enabled ' + format, async () => {
    const inputConfigDict = {
      'inputs': [
        {
          'name': TEST_DIR + 'BigBuckBunny.1080p.mp4',
          'media_type': 'video',
          'frame_rate': 24.0,
          'resolution': '1080p',
          'track_num': 0,
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
      ]
    };
    const pipelineConfigDict = {
      'streaming_mode': 'vod',
      'encryption': {
        // Enables encryption.
        'enable': true,
        'clear_lead': 0,
      },
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    // Player should raise an error and not load because the media
    // is encrypted and the player doesn't have a license server.
    await expectAsync(player.load(manifestUrl)).toBeRejectedWith(
        jasmine.objectContaining({
          code: shaka.util.Error.Code.NO_LICENSE_SERVER_GIVEN,
        }));

    player.configure({
      drm: {
        servers: {
          'com.widevine.alpha': 'https://cwip-shaka-proxy.appspot.com/no_auth',
        },
      },
    });
    // Player should now be able to load because the player has a license server.
    await player.load(manifestUrl);
  });
}

function codecTests(manifestUrl, format) {
  it('has output codecs matching the codecs in config ' + format, async () => {
    const inputConfigDict = {
      'inputs': [
        {
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'video',
          'track_num': 0,
          'frame_rate': 24.0,
          'resolution': '4k',
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
        {
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'audio',
          'track_num': 1,
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
      ],
    };
    const pipelineConfigDict = {
      'streaming_mode': 'vod',
      'resolutions': ['144p'],
      'audio_codecs': ['opus'],
      'video_codecs': ['h264'],
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);

    const trackList = player.getVariantTracks();
    const videoCodecList = trackList.map(track => track.videoCodec);
    const audioCodecList = trackList.map(track => track.audioCodec);
    expect(videoCodecList).toEqual(['avc1.42c01e']);
    expect(audioCodecList).toEqual(['opus']);
  });
}

function autoLanguageTests(manifestUrl, format) {
  it('correctly autodetects the language embedded in the stream ' + format,
      async () => {
    // No language is specified in the input config, so the streamer will try
    // to find the one embedded in the metadata.
    const inputConfigDict = {
      'inputs': [
        {
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'audio',
          'track_num': 1,
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
      ],
    };
    const pipelineConfigDict = {
      'streaming_mode': 'vod',
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);

    const trackList = player.getVariantTracks();
    const lang = trackList.map(track => track.language);
    expect(lang).toEqual(['en']);
  });
}

function languageTests(manifestUrl, format) {
  it('correctly sets the language read from the input config ' + format,
      async() => {
    const inputConfigDict = {
      'inputs': [
        {
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'audio',
          'track_num': 1,
          'language': 'zh',
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
      ],
    };
    const pipelineConfigDict = {
      'streaming_mode': 'vod',
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);

    const trackList = player.getVariantTracks();
    const lang = trackList.map(track => track.language);
    expect(lang).toEqual(['zh']);
  });
}

function textTracksTests(manifestUrl, format) {
  it('outputs correct text tracks ' + format, async () => {
    const inputConfigDict = {
      // List of inputs. Each one is a dictionary.
      'inputs': [
        {
          'name': TEST_DIR + 'BigBuckBunny.1080p.mp4',
          'media_type': 'video',
          'frame_rate': 24.0,
          'resolution': '1080p',
          'track_num': 0,
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
        {
          'name': TEST_DIR + 'Sintel.2010.English.vtt',
          'media_type': 'text',
          'language': 'en',
        },
        {
          'name': TEST_DIR + 'Sintel.2010.Spanish.vtt',
          'media_type': 'text',
          'language': 'es',
        },
        {
          'name': TEST_DIR + 'Sintel.2010.Esperanto.vtt',
          'media_type': 'text',
          'language': 'eo',
        },
        {
          'name': TEST_DIR + 'Sintel.2010.Arabic.vtt',
          'media_type': 'text',
          'language': 'ar',
        },
      ],
    };

    const pipelineConfigDict = {
      // Text inputs are currently only supported for VOD.
      'streaming_mode': 'vod',
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);

    const trackList = player.getTextTracks();
    const languageList = trackList.map(track => track.language);
    languageList.sort();
    expect(languageList).toEqual(['ar', 'en', 'eo', 'es']);
  });
}

function vodTests(manifestUrl, format) {
  it('has a vod streaming mode ' + format, async () => {
    const inputConfigDict = {
      // List of inputs. Each one is a dictionary.
      'inputs': [
        {
          'name': TEST_DIR + 'BigBuckBunny.1080p.mp4',
          'media_type': 'video',
          'frame_rate': 24.0,
          'resolution': '1080p',
          'track_num': 0,
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
      ],
    };

    const pipelineConfigDict = {
      'streaming_mode': 'vod',
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);
    expect(player.isLive()).toBe(false);
  });
}

function channelsTests(manifestUrl, channels, format) {
  it('outputs ' + channels + ' channels ' + format, async () => {
    const inputConfigDict = {
      // List of inputs. Each one is a dictionary.
      'inputs': [
        {
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'audio',
          'track_num': 1,
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
      ],
    };

    const pipelineConfigDict = {
      'streaming_mode': 'vod',
      'channels': channels,
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);
    const trackList = player.getVariantTracks();
    expect(trackList.length).toBe(1);
    expect(trackList[0].channelsCount).toBe(channels);
  });
}

function availabilityTests(manifestUrl, format) {
  it('outputs the correct availability window ' + format, async() => {
    const inputConfigDict = {
      'inputs': [
        {
          'input_type': 'looped_file',
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'video',
          'resolution': '720p',
          'frame_rate': 24.0,
          'track_num': 0,
        },
      ],
    };
    const pipelineConfigDict = {
      'streaming_mode': 'live',
      'availability_window': 500,
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    const response = await fetch(manifestUrl);
    const bodyText = await response.text();
    const re = /timeShiftBufferDepth="([^"]*)"/;
    const found = bodyText.match(re);
    expect(found).not.toBe(null);
    if (found) {
      expect(found[1]).toBe('PT500S');
    }
  });
}

function delayTests(manifestUrl, format) {
  it('outputs the correct presentation delay ' + format, async() => {
    const inputConfigDict = {
      'inputs': [
        {
          'input_type': 'looped_file',
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'video',
          'resolution': '720p',
          'frame_rate': 24.0,
          'track_num': 0,
        },
      ],
    };
    const pipelineConfigDict = {
      'streaming_mode': 'live',
      'presentation_delay': 100,
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);
    delay = player.getManifest().presentationTimeline.getDelay();
    expect(delay).toBe(100);
  });
}

function updateTests(manifestUrl, format) {
  it('outputs the correct update period ' + format, async() => {
    const inputConfigDict = {
      'inputs': [
        {
          'input_type': 'looped_file',
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'video',
          'resolution': '720p',
          'frame_rate': 24.0,
          'track_num': 0,
        },
      ],
    };
    const pipelineConfigDict = {
      'streaming_mode': 'live',
      'update_period': 42,
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    const response = await fetch(manifestUrl);
    const bodyText = await response.text();
    const re = /minimumUpdatePeriod="([^"]*)"/;
    const found = bodyText.match(re);
    expect(found).not.toBe(null);
    if (found) {
      expect(found[1]).toBe('PT42S');
    }
  });
}

function durationTests(manifestUrl, format) {
  it('outputs the correct duration of video ' + format, async() => {
    const inputConfigDict = {
      'inputs': [
        {
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'video',
          'resolution': '720p',
          'frame_rate': 24.0,
          'track_num': 0,
           // The original clip is 10 seconds long.
          'start_time': '00:00:02',
          'end_time': '00:00:05',
        },
      ],
    };
    const pipelineConfigDict = {
      'streaming_mode': 'vod',
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);
    // We took from 2-5, so the output should be about 3 seconds long.
    expect(video.duration).toBeCloseTo(3, 1 /* decimal points to check */);
  });
}

function mapTests(manifestUrl, format) {
  it('maps the correct inputs to outputs ' + format, async() => {
    const inputConfigDict = {
      'inputs': [
        // The order of inputs here is sensitive.
        // This is a regression test for a bug in which all VOD outputs were
        // mapped to input file 0, so the order of inputs here is sensitive.
        // Input #0 has only one track (0 for video).  Input #1 has more tracks
        // (0 for video, 1 for audio, 2 for subs).  So we ask for input #1 track
        // 1, and the bug would have mapped non-existent input #0 track 1.
        {
          'name': TEST_DIR + 'BigBuckBunny.1080p.mp4',
          'media_type': 'video',
          'resolution': '720p',
          'frame_rate': 24.0,
          'track_num': 0,
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
        {
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'audio',
          'track_num': 1,
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
      ],
    };
    const pipelineConfigDict = {
      'streaming_mode': 'vod',
      'resolutions': ['144p'],
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);

    // The failure would happen at the ffmpeg level, so we can be sure now that
    // the bug is fixed.  But let's go further and expect a single track with
    // both audio and video.
    const trackList = player.getVariantTracks();
    expect(trackList.length).toBe(1);
    expect(trackList[0].videoCodec).not.toBe(null);
    expect(trackList[0].audioCodec).not.toBe(null);
  });
}

function filterTests(manifestUrl, format) {
  it('filters inputs ' + format, async() => {
    const inputConfigDict = {
      'inputs': [
        {
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'video',
          'resolution': '720p',
          'frame_rate': 24.0,
          'track_num': 0,
          'filters': [
            // Resample frames to 90fps, which we can later detect.
            'fps=fps=90',
          ],
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
        {
          'name': TEST_DIR + 'Sintel.2010.720p.Small.mkv',
          'media_type': 'audio',
          'track_num': 1,
          'filters': [
            // Resample audio to 88.2kHz, which we can later detect.
            'aresample=88200',
          ],
          // Keep this test short by only encoding 1s of content.
          'end_time': '0:01',
        },
      ],
    };
    const pipelineConfigDict = {
      'streaming_mode': 'vod',
      'resolutions': ['144p'],
    };
    await startStreamer(inputConfigDict, pipelineConfigDict);
    await player.load(manifestUrl);

    const trackList = player.getVariantTracks();
    expect(trackList.length).toBe(1);
    expect(trackList[0].frameRate).toBe(90);
    // TODO(joeyparrish): expose sampleRate through Shaka Player API
    //expect(trackList[0].sampleRate).toBe(88200);
  });
}