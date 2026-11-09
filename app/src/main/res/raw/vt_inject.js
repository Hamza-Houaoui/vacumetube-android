// VacuumTube Android — injected web layer
// A faithful port of the desktop preload modules for the Android WebView app.
// window.VT_CONFIG is injected by the native layer before this script runs.
(function () {
    'use strict';

    if (window.__vtBooted) return;
    window.__vtBooted = true;
    console.log('[VT] injected, config keys: ' + Object.keys(window.VT_CONFIG || {}).join(','));

    var VT_CONFIG = window.VT_CONFIG || {};
    window.__vtSyncConfig = function (json) {
        VT_CONFIG = json;
        try { document.dispatchEvent(new CustomEvent('vt-config-update')); } catch (_) {}
    };

    function getConfig(key) { return VT_CONFIG[key]; }

    // ------------------------------------------------------------------
    // utils
    // ------------------------------------------------------------------
    function deepMerge(current, updates) {
        if (!current || typeof current !== 'object' || current === null) return;
        for (var key of Object.keys(updates)) {
            if (!current.hasOwnProperty(key) || typeof updates[key] !== 'object') {
                if (updates[key] === '__DELETE__') {
                    delete current[key];
                } else {
                    current[key] = updates[key];
                }
            } else {
                deepMerge(current[key], updates[key]);
            }
        }
        return current;
    }

    function waitForCondition(func) {
        return new Promise(function (resolve) {
            if (func()) return resolve();
            var interval = setInterval(function () {
                if (!func()) return;
                clearInterval(interval);
                resolve();
            }, 10);
        });
    }

    function waitForSelector(selector) {
        return new Promise(function (resolve) {
            var found = document.querySelector(selector);
            if (found) return resolve(found);

            var observer = new MutationObserver(function () {
                var el = document.querySelector(selector);
                if (el) {
                    resolve(el);
                    observer.disconnect();
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        });
    }

    function el(tag, attrs, children) {
        attrs = attrs || {};
        children = children || [];
        var element = document.createElement(tag);
        for (var key of Object.keys(attrs)) {
            var value = attrs[key];
            if (key === 'className') {
                element.className = value;
            } else if (key === 'textContent') {
                element.textContent = value;
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(element.style, value);
            } else if (key.startsWith('data')) {
                element.setAttribute(key.replace(/([A-Z])/g, '-$1').toLowerCase(), value);
            } else {
                element.setAttribute(key, value);
            }
        }
        for (var child of children) {
            if (child) element.appendChild(child);
        }
        return element;
    }

    // ------------------------------------------------------------------
    // locale (subset needed by the web modules)
    // ------------------------------------------------------------------
    var LOCALE = {
        general: {
            video_copied: 'Video link copied to clipboard',
            dislikes: 'Dislikes'
        },
        sponsorblock: {
            sponsor_skipped: 'Sponsor skipped',
            selfpromo_skipped: 'Self Promo skipped',
            interaction_skipped: 'Interaction skipped',
            intro_skipped: 'Intro skipped',
            outro_skipped: 'Outro skipped',
            preview_skipped: 'Preview skipped',
            hook_skipped: 'Hook/Greetings skipped',
            filler_skipped: 'Tangents/Jokes skipped'
        }
    };
    function getLocale() { return LOCALE; }

    // ------------------------------------------------------------------
    // JSON.parse modifiers
    // ------------------------------------------------------------------
    var jsonModifiers = [];
    var jsonParse = JSON.parse;
    JSON.parse = function () {
        var json = jsonParse.apply(this, arguments);
        try {
            if (typeof json === 'object') {
                for (var modifier of jsonModifiers) {
                    json = modifier(json);
                }
            }
            return json;
        } catch (err) {
            console.error('[VT] json modifier failed', err);
            return json;
        }
    };

    // ------------------------------------------------------------------
    // XHR modifiers
    // ------------------------------------------------------------------
    var responseModifiers = [];
    var requestModifiers = [];
    var OriginalXMLHttpRequest = window.XMLHttpRequest;

    window.XMLHttpRequest = function () {
        var xhr = new OriginalXMLHttpRequest();
        var originalOpen = xhr.open;
        var originalSend = xhr.send;

        xhr.open = async function (method, url) {
            this._method = method;
            this._url = url;
            return originalOpen.apply(this, arguments);
        };

        xhr.send = async function (body) {
            for (var modifier of requestModifiers) {
                try {
                    body = await modifier(xhr._url, body);
                } catch (err) {
                    console.error('[VT] xhr request modifier failed', err);
                }
            }
            return originalSend.call(this, body);
        };

        var readyStateHandler = null;
        var loadHandler = null;

        async function modifyResponse() {
            if (xhr.responseType !== '' && xhr.responseType !== 'text') return;
            if (xhr._modifiedAlready || xhr.readyState !== 4) return;
            xhr._modifiedAlready = true;

            var modifiedText = xhr.responseText;
            for (var modifier of responseModifiers) {
                try {
                    var modified = await modifier(xhr._url, modifiedText);
                    if (modified === undefined || modified === null) continue;
                    modifiedText = modified;
                } catch (err) {
                    console.error('[VT] xhr response modifier failed', err);
                }
            }

            try {
                Object.defineProperty(xhr, 'responseText', { get: function () { return modifiedText; } });
                Object.defineProperty(xhr, 'response', { get: function () { return modifiedText; } });
            } catch (_) {}
        }

        Object.defineProperty(xhr, 'onreadystatechange', {
            get: function () { return readyStateHandler; },
            set: function (handler) {
                readyStateHandler = async function () {
                    if (xhr.readyState === 4) await modifyResponse();
                    handler.apply(xhr, arguments);
                };
                xhr.addEventListener('readystatechange', readyStateHandler);
            }
        });

        Object.defineProperty(xhr, 'onload', {
            get: function () { return loadHandler; },
            set: function (handler) {
                loadHandler = async function () {
                    await modifyResponse();
                    handler.apply(xhr, arguments);
                };
                xhr.addEventListener('load', loadHandler);
            }
        });

        var originalAddEventListener = xhr.addEventListener;
        xhr.addEventListener = function (type, listener) {
            if (type === 'load') {
                var wrapped = async function () {
                    await modifyResponse();
                    listener.apply(xhr, arguments);
                };
                return originalAddEventListener.call(this, type, wrapped);
            }
            return originalAddEventListener.apply(this, arguments);
        };

        return xhr;
    };

    // ------------------------------------------------------------------
    // CSS injection (kept above YouTube styles)
    // ------------------------------------------------------------------
    var injectedStyles = {};
    var cssReady = false;
    var cssObserver = null;

    function reinjectStylesheets() {
        if (!cssObserver) return;
        cssObserver.disconnect();
        for (var id of Object.keys(injectedStyles)) {
            if (document.head && injectedStyles[id]) {
                document.head.appendChild(injectedStyles[id]);
            }
        }
        if (document.head) cssObserver.observe(document.head, { childList: true });
    }

    waitForCondition(function () { return !!document.head; }).then(function () {
        cssObserver = new MutationObserver(reinjectStylesheets);
        cssObserver.observe(document.head, { childList: true });
        cssReady = true;
    });

    function injectStyle(id, text) {
        return waitForCondition(function () { return cssReady; }).then(function () {
            var styleId = 'vt-' + id;
            var existing = document.getElementById(styleId);
            if (existing) existing.remove();

            var style = document.createElement('style');
            style.id = styleId;
            style.type = 'text/css';
            style.textContent = text;
            injectedStyles[id] = style;
            reinjectStylesheets();
        });
    }

    // ------------------------------------------------------------------
    // configOverrides (ytcfg / environment / tectonicConfig)
    // ------------------------------------------------------------------
    var ytcfgOverrides = [];
    var environmentOverrides = [];
    var tectonicConfigOverrides = [];

    setInterval(function () {
        if (!window.ytcfg || !window.ytcfg.data_ || ytcfgOverrides.length === 0) return;
        while (ytcfgOverrides.length > 0) {
            var override = ytcfgOverrides.shift();
            deepMerge(window.ytcfg.data_, override);
            window.ytcfg.set(window.ytcfg.data_);
        }
    }, 100);

    setInterval(function () {
        if (!window.environment || environmentOverrides.length === 0) return;
        while (environmentOverrides.length > 0) {
            deepMerge(window.environment, environmentOverrides.shift());
        }
    }, 100);

    setInterval(function () {
        if (!window.tectonicConfig || tectonicConfigOverrides.length === 0) return;
        while (tectonicConfigOverrides.length > 0) {
            deepMerge(window.tectonicConfig, tectonicConfigOverrides.shift());
        }
    }, 100);

    // ------------------------------------------------------------------
    // resolveCommand hooking
    // ------------------------------------------------------------------
    var inputModifiers = [];
    var outputModifiers = [];
    var globalResolveCommand = null;

    setInterval(function () {
        if (!window._yttv) return;
        for (var key in window._yttv) {
            if (window._yttv[key] && window._yttv[key].instance && window._yttv[key].instance.resolveCommand) {
                var resolveCommand = window._yttv[key].instance.resolveCommand;
                globalResolveCommand = function (command) {
                    return window._yttv[key].instance.resolveCommand(command);
                };

                window._yttv[key].instance.resolveCommand = function (command) {
                    for (var modifier of inputModifiers) {
                        command = modifier(command);
                        if (command === false) return true;
                    }
                    var output = resolveCommand.apply(this, [command]);
                    for (var out of outputModifiers) {
                        output = out(output);
                    }
                    return output;
                };
                return;
            }
        }
    }, 100);

    function resolveCommand(command) {
        if (globalResolveCommand) return globalResolveCommand(command);
        throw new Error('resolveCommand not ready');
    }

    function toast(title, subtitle) {
        try {
            resolveCommand({
                openPopupAction: {
                    popupType: 'TOAST',
                    popup: {
                        overlayToastRenderer: {
                            title: { simpleText: title },
                            subtitle: { simpleText: subtitle }
                        }
                    }
                }
            });
        } catch (_) {
            var t = document.getElementById('vt-fallback-toast');
            if (!t) {
                t = el('div', { id: 'vt-fallback-toast', textContent: subtitle });
                t.style.cssText = [
                    'position:fixed;top:20px;right:20px;z-index:999999;',
                    'background:rgba(0,0,0,0.85);color:#fff;padding:12px 20px;border-radius:12px;',
                    'font-size:16px;opacity:0;transition:opacity .3s;pointer-events:none;'
                ].join('');
                document.body.appendChild(t);
            }
            t.textContent = subtitle;
            t.style.opacity = '1';
            clearTimeout(t._t);
            t._t = setTimeout(function () { t.style.opacity = '0'; }, 2000);
        }
    }

    // ------------------------------------------------------------------
    // base css
    // ------------------------------------------------------------------
    waitForCondition(function () { return !!document.documentElement; }).then(function () {
        injectStyle('patches', [
            '::-webkit-scrollbar { display: none !important; }',
            'body { user-select: none; -webkit-user-select: none; }',
            '#vt-speed-indicator, #vt-volume-indicator {',
            '  position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);',
            '  background-color: rgba(0,0,0,0.5); color: white; padding: 12px 24px;',
            '  border-radius: 1.5rem; display: flex; align-items: center; z-index: 999999;',
            '  opacity: 0; transition: opacity .3s ease-in-out; pointer-events: none;',
            '}',
            '#vt-speed-indicator.visible, #vt-volume-indicator.visible { opacity: 1; }',
            '.vt-speed-icon { width:24px;height:24px;margin-right:16px;font-size:24px;font-family:"YouTube Icons Outlined"; }',
            '.vt-speed-icon::before { content:"\\edf6"; }',
            '.vt-speed-text { font-size:18px;font-weight:500;min-width:30px;text-align:right; }',
            'div[idomkey="lazy-mdx-volume"] { display: none !important; }',
            '.vt-volume-bar-container { width:200px;height:8px;background-color:rgba(255,255,255,0.3);border-radius:4px;overflow:hidden; }',
            '.vt-volume-bar { height:100%;width:50%;background-color:white;border-radius:4px;transition:width .1s linear; }',
            '.vt-volume-text { font-size:18px;font-weight:500;min-width:55px;text-align:right;margin-left:16px; }',
            '.vt-volume-icon { width:24px;height:24px;margin-right:16px;font-size:24px;font-family:"YouTube Icons Outlined"; }',
            '.vt-volume-icon.vt-volume-high::before { content:"\\ed89"; }',
            '.vt-volume-icon.vt-volume-low::before { content:"\\ed8a"; }',
            '.vt-volume-icon.vt-volume-muted::before { content:"\\e04e"; }'
        ].join('\n'));
    });

    // ------------------------------------------------------------------
    // MODULE: environment / identity
    // ------------------------------------------------------------------
    // advertise webp (support-webp) and low memory mode, like desktop
    ytcfgOverrides.push({ INNERTUBE_CONTEXT: { client: { webpSupport: true } } });

    if (getConfig('low_memory_mode')) {
        environmentOverrides.push({ feature_switches: { enable_memory_saving_mode: true } });
    }

    // h5vcc stub so Cobalt-specific YouTube code doesn't crash
    (function () {
        var resolutions = ['256x144','426x240','640x360','854x480','1280x720','1920x1080','2560x1440','3840x2160','7680x4320'];
        function maxResolution() {
            if (getConfig('unlock_resolution')) return '7680x4320';
            var w = Math.max(window.screen.width, window.screen.height);
            var h = Math.min(window.screen.width, window.screen.height);
            for (var r of resolutions) {
                var parts = r.split('x').map(Number);
                if (w <= parts[0] && h <= parts[1]) return r;
            }
            return w + 'x' + h;
        }
        window.h5vcc = {
            dial: {},
            runtime: { initialDeepLink: null },
            system: {
                getVideoContainerSizeOverride: function () { return maxResolution(); }
            }
        };
        try {
            if (window.Android) {
                window.h5vcc.runtime.initialDeepLink = null;
            }
        } catch (_) {}
    })();

    // ------------------------------------------------------------------
    // MODULE: adblock
    // ------------------------------------------------------------------
    responseModifiers.push(function (url, text) {
        if (!getConfig('adblock')) return;
        if (!url.startsWith('/youtubei/v1/browse') && !url.startsWith('/youtubei/v1/search')) return;

        var json = JSON.parse(text);

        if (url.startsWith('/youtubei/v1/browse')) {
            var homeFeed = json.contents && json.contents.tvBrowseRenderer && json.contents.tvBrowseRenderer.content && json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer && json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content && json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer;
            if (!homeFeed || !homeFeed.contents) return;

            homeFeed.contents = homeFeed.contents.filter(function (r) {
                return !r.adSlotRenderer && !r.promoShelfRenderer && !(r.shelfRenderer && r.shelfRenderer.tvhtml5Metadata && r.shelfRenderer.tvhtml5Metadata.hideLogo);
            });

            for (var feed of homeFeed.contents) {
                var horizontal = feed && feed.shelfRenderer && feed.shelfRenderer.content && feed.shelfRenderer.content.horizontalListRenderer;
                if (!horizontal || !horizontal.items) continue;
                horizontal.items = horizontal.items.filter(function (i) { return !i.adSlotRenderer; });
            }
        } else if (url.startsWith('/youtubei/v1/search')) {
            var searchFeed = json.contents && json.contents.sectionListRenderer;
            if (!searchFeed || !searchFeed.contents) return;
            for (var sfeed of searchFeed.contents) {
                var shorizontal = sfeed && sfeed.shelfRenderer && sfeed.shelfRenderer.content && sfeed.shelfRenderer.content.horizontalListRenderer;
                if (!shorizontal || !shorizontal.items) continue;
                shorizontal.items = shorizontal.items.filter(function (i) { return !i.adSlotRenderer; });
            }
        }

        return JSON.stringify(json);
    });

    jsonModifiers.push(function (json) {
        if (!getConfig('adblock')) return json;
        if (json && json.adPlacements) json.adPlacements = [];
        if (json && json.adSlots) json.adSlots = [];
        return json;
    });

    jsonModifiers.push(function (json) {
        if (!getConfig('adblock')) return json;
        if (json && json.entries && Array.isArray(json.entries)) {
            json.entries = json.entries.filter(function (e) {
                return !(e && e.command && e.command.reelWatchEndpoint && e.command.reelWatchEndpoint.adClientParams && e.command.reelWatchEndpoint.adClientParams.isAd);
            });
        }
        return json;
    });

    // ------------------------------------------------------------------
    // MODULE: hide short
    // ------------------------------------------------------------------
    responseModifiers.push(function (url, text) {
        if (!getConfig('hide_shorts')) return;
        if (!url.startsWith('/youtubei/v1/browse')) return;

        var json = JSON.parse(text);
        var sectionList = (json.continuationContents && json.continuationContents.sectionListContinuation) ||
            (json.contents && json.contents.tvBrowseRenderer && json.contents.tvBrowseRenderer.content && json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer && json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content && json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer);
        if (!sectionList) return;

        sectionList.contents = sectionList.contents.filter(function (i) {
            var avatarTitle = i && i.shelfRenderer && i.shelfRenderer.headerRenderer && i.shelfRenderer.headerRenderer.shelfHeaderRenderer && i.shelfRenderer.headerRenderer.shelfHeaderRenderer.avatarLockup && i.shelfRenderer.headerRenderer.shelfHeaderRenderer.avatarLockup.avatarLockupRenderer && i.shelfRenderer.headerRenderer.shelfHeaderRenderer.avatarLockup.avatarLockupRenderer.title && i.shelfRenderer.headerRenderer.shelfHeaderRenderer.avatarLockup.avatarLockupRenderer.title.runs && i.shelfRenderer.headerRenderer.shelfHeaderRenderer.avatarLockup.avatarLockupRenderer.title.runs[0];
            return !(avatarTitle && avatarTitle.text === 'Shorts');
        });

        return JSON.stringify(json);
    });

    // ------------------------------------------------------------------
    // MODULE: guide tabs
    // ------------------------------------------------------------------
    var TAB_MAP = {
        'SEARCH': 'search',
        'YOUTUBE_SHORTS_FILL_24': 'shorts',
        'SUBSCRIPTIONS': 'subscriptions',
        'TAB_LIBRARY': 'library',
        'GAMING': 'gaming',
        'YOUTUBE_MUSIC': 'music',
        'NEWS': 'news',
        'BROADCAST': 'podcasts',
        'CLAPPERBOARD': 'movies_and_tv',
        'LIVE': 'live',
        'TROPHY': 'sports'
    };

    responseModifiers.push(function (url, text) {
        if (!url.startsWith('/youtubei/v1/guide')) return;

        var disabled = VT_CONFIG.disabled_tabs || [];
        if (!Array.isArray(disabled) || disabled.length === 0) return;

        var json = JSON.parse(text);
        var items = json.items;
        if (!items || items.length === 0) return;
        var section = items[items.length - 1];

        if (section && section.guideSectionRenderer && section.guideSectionRenderer.items) {
            section.guideSectionRenderer.items = section.guideSectionRenderer.items.filter(function (i) {
                var icon = i && i.guideEntryRenderer && i.guideEntryRenderer.icon && i.guideEntryRenderer.icon.iconType;
                return !disabled.includes(TAB_MAP[icon]);
            });
        }

        return JSON.stringify(json);
    });

    // ------------------------------------------------------------------
    // MODULE: remove super resolution
    // ------------------------------------------------------------------
    jsonModifiers.push(function (json) {
        if (!getConfig('remove_super_resolution')) return json;
        if (!json || !json.streamingData || !json.streamingData.adaptiveFormats) return json;

        json.streamingData.adaptiveFormats = json.streamingData.adaptiveFormats.filter(function (f) {
            return f.xtags !== 'CgcKAnNyEgEx';
        });

        return json;
    });

    // ------------------------------------------------------------------
    // MODULE: h264ify
    // ------------------------------------------------------------------
    (function () {
        var video = document.createElement('video');
        var canPlayType = video.canPlayType.bind(video);
        video.__proto__.canPlayType = makeModifiedTypeChecker();

        function makeModifiedTypeChecker(isTypeSupported) {
            return function (type) {
                if (getConfig('h264ify')) {
                    var cfg = VT_CONFIG;
                    if (cfg.h264ify_disable_webm && type.includes('webm') ||
                        cfg.h264ify_disable_vp8 && type.includes('vp8') ||
                        cfg.h264ify_disable_vp9 && type.includes('vp9') ||
                        cfg.h264ify_disable_av1 && type.includes('av01')) {
                        return '';
                    }
                }
                if (isTypeSupported) return isTypeSupported(type);
                return canPlayType(type);
            };
        }

        var mse = window.MediaSource;
        if (mse && mse.isTypeSupported) {
            mse.isTypeSupported = makeModifiedTypeChecker(mse.isTypeSupported.bind(mse));
        }
    })();

    // ------------------------------------------------------------------
    // MODULE: SponsorBlock
    // ------------------------------------------------------------------
    (function () {
        var SPONSORBLOCK_CATEGORIES = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'hook', 'filler'];
        var segments = [];
        var activeVideoId = null;
        var attachTimeout = null;
        var activeVideo = null;

        async function fetchSegments(videoId) {
            var categories = SPONSORBLOCK_CATEGORIES.filter(function (c) { return getConfig('sponsorblock_skip_' + c); });
            if (categories.length === 0) return [];

            var url = 'https://sponsor.ajay.app/api/skipSegments?videoID=' + encodeURIComponent(videoId) +
                '&categories=' + encodeURIComponent(categories.join(','));

            var res = await fetch(url);
            if (res.status === 404) return [];
            if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
            var data = await res.json();
            if (!Array.isArray(data)) return [];

            return data
                .filter(function (s) { return s && Array.isArray(s.segment) && categories.includes(s.category); })
                .map(function (s) { return { startTime: s.segment[0], endTime: s.segment[1], category: s.category }; });
        }

        function attachToVideo() {
            clearTimeout(attachTimeout);
            attachTimeout = null;
            activeVideo = document.querySelector('video');
            if (!activeVideo) {
                attachTimeout = setTimeout(attachToVideo, 100);
                return;
            }
            activeVideo.addEventListener('timeupdate', checkForSponsorSkip);
        }

        function checkForSponsorSkip() {
            if (!getConfig('sponsorblock') || !activeVideo || segments.length === 0) return;
            if (activeVideo.paused) return;

            var matching = segments.filter(function (v) {
                return activeVideo.currentTime > v.startTime &&
                    activeVideo.currentTime < v.startTime + 2 &&
                    activeVideo.currentTime < v.endTime;
            }).sort(function (a, b) { return a.startTime - b.startTime; });

            if (matching.length === 0) return;

            activeVideo.currentTime = matching[0].endTime;
            toast('VacuumTube', getLocale().sponsorblock[matching[0].category + '_skipped'] || 'Skipped');
        }

        window.addEventListener('hashchange', function () {
            if (!getConfig('sponsorblock')) return;

            var pageUrl = new URL(location.hash.substring(1), location.href);
            if (pageUrl.pathname === '/watch') {
                var videoId = pageUrl.searchParams.get('v');
                if (!videoId) return;

                fetchSegments(videoId).then(function (seg) {
                    segments = seg;
                    activeVideoId = videoId;
                    attachToVideo();
                }).catch(function (err) {
                    console.error('[VT] SponsorBlock fetch failed', err);
                });
            } else {
                activeVideo = null;
                activeVideoId = null;
                segments = [];
                if (attachTimeout != null) {
                    clearTimeout(attachTimeout);
                    attachTimeout = null;
                }
            }
        });
    })();

    // ------------------------------------------------------------------
    // MODULE: DeArrow
    // ------------------------------------------------------------------
    (function () {
        var cache = {};

        async function getBranding(id) {
            if (id in cache) return cache[id];
            var res = await fetch('https://sponsor.ajay.app/api/branding?videoID=' + id);
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
            var data = await res.json();
            cache[id] = data;
            return data;
        }

        function getThumbnail(id) {
            return 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=' + id;
        }

        responseModifiers.push(async function (url, text) {
            if (!getConfig('dearrow')) return;
            if (!url.startsWith('/youtubei/v1/browse') &&
                !url.startsWith('/youtubei/v1/search') &&
                !url.startsWith('/youtubei/v1/next')) return;

            var json = JSON.parse(text);
            var items = [];

            if ((json.continuationContents && json.continuationContents.horizontalListContinuation) ||
                (json.continuationContents && json.continuationContents.gridContinuation)) {
                if (json.continuationContents.horizontalListContinuation && json.continuationContents.horizontalListContinuation.items) {
                    items = json.continuationContents.horizontalListContinuation.items;
                } else if (json.continuationContents.gridContinuation && json.continuationContents.gridContinuation.items) {
                    items = json.continuationContents.gridContinuation.items;
                }
                if (!items || !items.length) return;
            } else {
                var contents = [];

                if (url.startsWith('/youtubei/v1/browse')) {
                    if (json.contents && json.contents.tvBrowseRenderer && json.contents.tvBrowseRenderer.content && json.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer && json.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections) {
                        var tvSecondaryNavRenderer = json.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer;
                        for (var section of tvSecondaryNavRenderer.sections) {
                            if (!section.tvSecondaryNavSectionRenderer || !section.tvSecondaryNavSectionRenderer.tabs) continue;
                            var tab = section.tvSecondaryNavSectionRenderer.tabs[0];
                            var tabContent = tab && tab.tabRenderer && tab.tabRenderer.content && tab.tabRenderer.content.tvSurfaceContentRenderer && tab.tabRenderer.content.tvSurfaceContentRenderer.content && tab.tabRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer;
                            contents = tabContent ? tabContent.contents : contents;
                        }
                    } else if (json.contents && json.contents.tvBrowseRenderer && json.contents.tvBrowseRenderer.content && json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer && json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content) {
                        var tc = json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content;
                        if (tc.sectionListRenderer && tc.sectionListRenderer.contents) {
                            contents = tc.sectionListRenderer.contents;
                        } else if (tc.gridRenderer) {
                            contents = [tc];
                        }
                    } else if (json.continuationContents && json.continuationContents.tvSurfaceContentContinuation && json.continuationContents.tvSurfaceContentContinuation.content && json.continuationContents.tvSurfaceContentContinuation.content.sectionListRenderer) {
                        contents = json.continuationContents.tvSurfaceContentContinuation.content.sectionListRenderer.contents;
                    }
                } else if (url.startsWith('/youtubei/v1/search')) {
                    contents = json.contents && json.contents.sectionListRenderer ? json.contents.sectionListRenderer.contents : [];
                } else if (url.startsWith('/youtubei/v1/next')) {
                    contents = json.contents && json.contents.singleColumnWatchNextResults && json.contents.singleColumnWatchNextResults.pivot && json.contents.singleColumnWatchNextResults.pivot.sectionListRenderer ? json.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents : [];
                }

                if (!contents || !contents.length) return;

                for (var content of contents) {
                    var someItems;
                    if (content.shelfRenderer) {
                        someItems = content.shelfRenderer.content && content.shelfRenderer.content.horizontalListRenderer ? content.shelfRenderer.content.horizontalListRenderer.items : null;
                    } else if (content.gridRenderer) {
                        someItems = content.gridRenderer.items;
                    }
                    if (!someItems) continue;
                    items = items.concat(someItems);
                }
            }

            if (!items.length) return;

            var promises = [];
            for (var item of items) {
                if (!item.tileRenderer) continue;
                if (item.tileRenderer.contentType !== 'TILE_CONTENT_TYPE_VIDEO') continue;

                var id = item.tileRenderer.contentId;
                promises.push((async function () {
                    try {
                        if (!item.tileRenderer.metadata) return;
                        var branding = await getBranding(id);
                        if (!branding) return;

                        var goodTitle = (branding.titles || []).find(function (t) { return t.locked || t.votes >= 0; });
                        if (goodTitle && item.tileRenderer.metadata.tileMetadataRenderer && item.tileRenderer.metadata.tileMetadataRenderer.title) {
                            var words = goodTitle.title.split(' ').map(function (w) {
                                if (w.startsWith('>')) w = w.slice(1);
                                return w;
                            });
                            item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = words.join(' ');
                        }

                        if (item.tileRenderer.header && item.tileRenderer.header.tileHeaderRenderer && item.tileRenderer.header.tileHeaderRenderer.thumbnail && item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails && item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0]) {
                            item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url = getThumbnail(id);
                        }
                    } catch (err) {
                        console.error('[VT] dearrow failed', err);
                    }
                })());
            }

            if (promises.length > 0) await Promise.all(promises);

            return JSON.stringify(json);
        });
    })();

    // ------------------------------------------------------------------
    // MODULE: Return YouTube Dislike
    // ------------------------------------------------------------------
    (function () {
        async function fetchDislikes(videoId) {
            var res = await fetch('https://returnyoutubedislikeapi.com/Votes?videoId=' + videoId);
            if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
            return await res.json();
        }

        responseModifiers.push(async function (url, text) {
            if (!getConfig('dislikes')) return;
            if (!url.startsWith('/youtubei/v1/next')) return;

            var json = JSON.parse(text);
            var videoId = json.currentVideoEndpoint && json.currentVideoEndpoint.watchEndpoint ? json.currentVideoEndpoint.watchEndpoint.videoId : null;
            if (!videoId) return;

            var panel = (json.engagementPanels || []).find(function (p) {
                return p.engagementPanelSectionListRenderer && p.engagementPanelSectionListRenderer.panelIdentifier === 'video-description-ep-identifier';
            });
            if (!panel) return;

            var engagementActions = json.transportControls && json.transportControls.transportControlsRenderer ? json.transportControls.transportControlsRenderer.engagementActions : null;
            var likesEngagement = (engagementActions || []).find(function (a) { return a.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_LIKE_BUTTON'; });

            var votes;
            try {
                votes = await fetchDislikes(videoId);
            } catch (err) {
                console.error('[VT] fetching dislikes failed', err);
                return;
            }

            var dislikes = votes.dislikes || 0;
            var abbreviated = Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(dislikes);

            var descriptionHeader = panel.engagementPanelSectionListRenderer.content &&
                panel.engagementPanelSectionListRenderer.content.structuredDescriptionContentRenderer &&
                panel.engagementPanelSectionListRenderer.content.structuredDescriptionContentRenderer.items[0] &&
                panel.engagementPanelSectionListRenderer.content.structuredDescriptionContentRenderer.items[0].videoDescriptionHeaderRenderer;

            if (descriptionHeader && Array.isArray(descriptionHeader.factoid)) {
                descriptionHeader.factoid.push({
                    factoidRenderer: {
                        value: { simpleText: abbreviated },
                        label: { simpleText: getLocale().general.dislikes }
                    }
                });
            }

            if (likesEngagement && likesEngagement.button && likesEngagement.button.likeButtonRenderer) {
                if (likesEngagement.button.likeButtonRenderer.dislikeCountText) {
                    likesEngagement.button.likeButtonRenderer.dislikeCountText.simpleText = abbreviated;
                }
                if (likesEngagement.button.likeButtonRenderer.dislikeCountWithUndislikeText) {
                    likesEngagement.button.likeButtonRenderer.dislikeCountWithUndislikeText.simpleText = abbreviated;
                }
            }

            return JSON.stringify(json);
        });
    })();

    // ------------------------------------------------------------------
    // MODULE: volume control
    // ------------------------------------------------------------------
    (function () {
        function isWatching() {
            var isShort = document.querySelector('ytlr-shorts-page') && document.querySelector('ytlr-shorts-page').classList.contains('zylon-focus');
            if (isShort) return true;

            var baseUri = window.yt && window.yt.player && window.yt.player.utils ? window.yt.player.utils.videoElement_ && window.yt.player.utils.videoElement_.baseURI : null;
            return !!(baseUri && baseUri.includes('/watch?v='));
        }

        var volume = getConfig('volume') !== undefined ? getConfig('volume') : 100;
        var muted = false;
        var volumeTimeout;

        function showVolumeIndicator() {
            var indicator = document.getElementById('vt-volume-indicator');
            var bar = document.getElementById('vt-volume-bar');
            var text = document.getElementById('vt-volume-text');
            var icon = document.getElementById('vt-volume-icon');
            if (!indicator || !bar || !text || !icon) return;

            var userFacingVolume = muted ? 0 : volume;
            bar.style.width = userFacingVolume + '%';
            text.textContent = userFacingVolume + '%';

            if (volume === 0 || muted) {
                icon.className = 'vt-volume-icon vt-volume-muted';
            } else if (volume <= 50) {
                icon.className = 'vt-volume-icon vt-volume-low';
            } else {
                icon.className = 'vt-volume-icon vt-volume-high';
            }

            indicator.classList.add('visible');
            clearTimeout(volumeTimeout);
            volumeTimeout = setTimeout(function () { indicator.classList.remove('visible'); }, 1500);
        }

        function setVolume() {
            var players = document.querySelectorAll('.html5-video-player');
            for (var player of players) {
                if (!player || !player.setVolume) continue;
                try { player.setVolume(muted ? 0 : volume); } catch (_) {}
            }
            try { if (window.Android) window.Android.setVolume(muted ? 0 : volume); } catch (_) {}
        }

        function setVolumeFromKey(e) {
            if (!isWatching()) return false;
            var key = e.key || e.keyCode;

            if (key === '+' || key === '=' || key === 187) {
                volume = Math.min(100, volume + 5);
            } else if (key === '-' || key === 189) {
                volume = Math.max(0, volume - 5);
            } else if (key === 'm' || key === 'M' || key === 77) {
                muted = !muted;
            } else {
                return false;
            }
            return true;
        }

        document.addEventListener('keydown', function (e) {
            if (!setVolumeFromKey(e)) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showVolumeIndicator();
            setVolume();
        }, true);

        // handle cast volume commands through the same UI
        inputModifiers.push(function (c) {
            if (!c.volumeControlAction) return c;
            var action = c.volumeControlAction;
            var type = action.volumeControlType;

            if (type === 'VOLUME_CONTROL_ACTION_TYPE_MUTE') {
                muted = true;
            } else if (type === 'VOLUME_CONTROL_ACTION_TYPE_UNMUTE') {
                muted = false;
            } else if (type === 'VOLUME_CONTROL_ACTION_TYPE_SET_ABSOLUTE') {
                volume = action.volumeControlValue;
            }

            showVolumeIndicator();
            setVolume();
            return false;
        });

        // player elements can change; reapply
        setInterval(setVolume, 500);
    })();

    // ------------------------------------------------------------------
    // MODULE: speed control
    // ------------------------------------------------------------------
    (function () {
        var lastCustomRate = 2;
        var currentRate = 1;
        var speedTimeout;

        function showSpeedIndicator() {
            var indicator = document.getElementById('vt-speed-indicator');
            var text = document.getElementById('vt-speed-text');
            if (!indicator || !text) return;
            text.textContent = currentRate + 'x';
            indicator.classList.add('visible');
            clearTimeout(speedTimeout);
            speedTimeout = setTimeout(function () { indicator.classList.remove('visible'); }, 1500);
        }

        function setPlaybackRate(step) {
            var players = document.querySelectorAll('.html5-video-player');
            for (var player of players) {
                if (!player || !player.setPlaybackRate) continue;
                currentRate = player.getPlaybackRate();
                if (step === 0) {
                    if (currentRate !== 1) {
                        lastCustomRate = currentRate;
                        currentRate = 1;
                    } else {
                        currentRate = lastCustomRate;
                    }
                } else {
                    currentRate = Math.max(0.25, Math.min(currentRate + step, 2));
                }
                try { player.setPlaybackRate(currentRate); } catch (_) {}
            }
        }

        function isWatching() {
            var isShort = document.querySelector('ytlr-shorts-page') && document.querySelector('ytlr-shorts-page').classList.contains('zylon-focus');
            if (isShort) return true;
            var baseUri = window.yt && window.yt.player && window.yt.player.utils ? window.yt.player.utils.videoElement_ && window.yt.player.utils.videoElement_.baseURI : null;
            return !!(baseUri && baseUri.includes('/watch?v='));
        }

        document.addEventListener('keydown', function (e) {
            var key = e.key || e.keyCode;
            if (!key || !isWatching()) return;

            if (key === 's' || key === 'S') {
                setPlaybackRate(0);
            } else if (key === 'a' || key === 'A') {
                setPlaybackRate(-0.25);
            } else if (key === 'd' || key === 'D') {
                setPlaybackRate(0.25);
            } else {
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showSpeedIndicator();
        }, true);
    })();

    // ------------------------------------------------------------------
    // MODULE: keybinds (copy video URL)
    // ------------------------------------------------------------------
    (function () {
        var lastShortId = null;

        inputModifiers.push(function (c) {
            if (c.reelWatchEndpoint) lastShortId = c.reelWatchEndpoint.videoId;
            return c;
        });

        document.addEventListener('keydown', function (e) {
            if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
            if (!(e.key && e.key.toLowerCase() === 'c')) return;

            var url = null;
            var isShort = document.querySelector('ytlr-shorts-page') && document.querySelector('ytlr-shorts-page').classList.contains('zylon-focus');
            if (isShort && lastShortId) {
                url = 'https://youtube.com/shorts/' + lastShortId;
            } else {
                var baseUri = window.yt && window.yt.player && window.yt.player.utils ? window.yt.player.utils.videoElement_ && window.yt.player.utils.videoElement_.baseURI : null;
                if (!baseUri || !baseUri.includes('/watch?v=')) return;
                var id = baseUri.split('/watch?v=')[1].slice(0, 11);
                if (!id) return;
                url = 'https://youtu.be/' + id;
            }

            e.preventDefault();
            e.stopImmediatePropagation();
            try {
                if (window.Android) window.Android.copyToClipboard(url);
            } catch (_) {}
            toast('VacuumTube', getLocale().general.video_copied);
        }, true);
    })();

    // ------------------------------------------------------------------
    // MODULE: exit app (fix-exit)
    // ------------------------------------------------------------------
    inputModifiers.push(function (c) {
        if (c.commandExecutorCommand && c.commandExecutorCommand.commands) {
            var hasExit = c.commandExecutorCommand.commands.some(function (cmd) {
                return cmd && cmd.signalAction && cmd.signalAction.signal === 'EXIT_APP';
            });
            if (hasExit) {
                try { if (window.Android) window.Android.exitApp(); } catch (_) {}
                return false;
            }
        }
        return c;
    });

    // ------------------------------------------------------------------
    // MODULE: music mode
    // ------------------------------------------------------------------
    (function () {
        var featureEnabled = getConfig('features_enabled') === true && getConfig('music_mode_feature') === true;
        var enabled = featureEnabled && getConfig('music_mode') === true;

        function isObject(value) {
            return value !== null && typeof value === 'object' && !Array.isArray(value);
        }

        function isPlayerResponse(value) {
            return isObject(value) && isObject(value.streamingData) && isObject(value.videoDetails);
        }

        function getThumbnail(playerResponse) {
            var thumbnails = playerResponse.videoDetails && playerResponse.videoDetails.thumbnail && playerResponse.videoDetails.thumbnail.thumbnails;
            if (Array.isArray(thumbnails)) {
                var largest = thumbnails.filter(function (t) { return typeof t.url === 'string' && t.url.length > 0; })
                    .sort(function (a, b) { return ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)); })[0];
                if (largest) return largest;
            }
            var videoId = playerResponse.videoDetails && playerResponse.videoDetails.videoId;
            if (typeof videoId === 'string' && videoId.length > 0) {
                return { url: 'https://i.ytimg.com/vi/' + encodeURIComponent(videoId) + '/hqdefault.jpg', width: 480, height: 360 };
            }
            return null;
        }

        function enableAudioOnly(playerResponse) {
            if (!isPlayerResponse(playerResponse)) return null;
            if (!isObject(playerResponse.playerConfig)) playerResponse.playerConfig = {};
            if (!isObject(playerResponse.playerConfig.audioConfig)) playerResponse.playerConfig.audioConfig = {};
            playerResponse.playerConfig.audioConfig.playAudioOnly = true;
            playerResponse.videoDetails.musicVideoType = 'MUSIC_VIDEO_TYPE_ATV';
            return getThumbnail(playerResponse);
        }

        function getWatchMetadataItem(json) {
            var contents = json.contents && json.contents.singleColumnWatchNextResults && json.contents.singleColumnWatchNextResults.results && json.contents.singleColumnWatchNextResults.results.results ? json.contents.singleColumnWatchNextResults.results.results.contents : null;
            if (!Array.isArray(contents)) return null;
            for (var result of contents) {
                var items = result && result.itemSectionRenderer ? result.itemSectionRenderer.contents : null;
                if (!Array.isArray(items)) continue;
                var found = items.find(function (candidate) { return candidate && candidate.videoMetadataRenderer; });
                if (found) return found;
            }
            return null;
        }

        function asThumbnailModel(currentVideoThumbnail, fallbackThumbnail) {
            if (currentVideoThumbnail && Array.isArray(currentVideoThumbnail.thumbnails) && currentVideoThumbnail.thumbnails.length > 0) {
                return { thumbnails: currentVideoThumbnail.thumbnails };
            }
            if (fallbackThumbnail && typeof fallbackThumbnail.url === 'string') {
                return { thumbnails: [fallbackThumbnail] };
            }
            return null;
        }

        function enableNativeMusicRenderer(json, fallbackThumbnail) {
            if (!isObject(json)) return false;
            var metadataItem = getWatchMetadataItem(json);
            var videoMetadata = metadataItem && metadataItem.videoMetadataRenderer;
            if (!videoMetadata) return false;

            var currentVideoThumbnail = isObject(json.currentVideoThumbnail) ? json.currentVideoThumbnail : null;
            var thumbnailModel = asThumbnailModel(currentVideoThumbnail, fallbackThumbnail);
            var musicMetadata = {
                title: videoMetadata.title,
                byline: videoMetadata.owner && videoMetadata.owner.videoOwnerRenderer ? videoMetadata.owner.videoOwnerRenderer.title : undefined,
                secondaryTitle: videoMetadata.title,
                viewCountText: videoMetadata.viewCount && videoMetadata.viewCount.videoViewCountRenderer ? videoMetadata.viewCount.videoViewCountRenderer.shortViewCount : undefined,
                mayTruncateChannelName: true,
                trackingParams: videoMetadata.trackingParams
            };

            if (thumbnailModel) {
                musicMetadata.blurredBackgroundThumbnail = thumbnailModel;
                if (!currentVideoThumbnail) json.currentVideoThumbnail = thumbnailModel;
            }

            if (currentVideoThumbnail && isObject(currentVideoThumbnail.darkColorPalette)) {
                musicMetadata.darkColorPalette = currentVideoThumbnail.darkColorPalette;
            }

            for (var key of Object.keys(musicMetadata)) {
                if (musicMetadata[key] === undefined) delete musicMetadata[key];
            }

            delete metadataItem.videoMetadataRenderer;
            metadataItem.musicWatchMetadataRenderer = musicMetadata;
            return true;
        }

        function getPlayerResponses(json) {
            var candidates = [json, json && json.playerResponse];
            return candidates.filter(function (candidate, index) {
                return isPlayerResponse(candidate) && candidates.indexOf(candidate) === index;
            });
        }

        var lastThumbnail = null;

        jsonModifiers.push(function (json) {
            if (!featureEnabled || !enabled) return json;
            for (var playerResponse of getPlayerResponses(json)) {
                var thumb = enableAudioOnly(playerResponse);
                if (thumb) lastThumbnail = thumb;
            }
            enableNativeMusicRenderer(json, lastThumbnail);
            return json;
        });

        function walkCommands(command) {
            var commands = [command];
            for (var i = 0; i < commands.length; i++) {
                var nested = commands[i] && commands[i].commandExecutorCommand && commands[i].commandExecutorCommand.commands;
                if (Array.isArray(nested)) commands.push.apply(commands, nested);
            }
            return commands.filter(Boolean);
        }

        inputModifiers.push(function (c) {
            var has = walkCommands(c).some(function (cmd) {
                return cmd && cmd.signalAction && cmd.signalAction.signal === 'VT_MUSIC_MODE_TOGGLE';
            });
            if (has) {
                enabled = !enabled;
                try {
                    if (window.Android) window.Android.setConfig({ music_mode: enabled });
                } catch (_) {}
                setTimeout(function () {
                    try {
                        resolveCommand({ signalAction: { signal: 'POPUP_BACK' } });
                    } catch (_) {}
                }, 0);
                try {
                    var player = document.querySelector('.html5-video-player');
                    if (player && player.loadVideoById) {
                        var videoData = player.getVideoData ? player.getVideoData() : {};
                        var videoId = videoData.video_id || videoData.videoId;
                        if (videoId) {
                            var currentTime = Number(player.getCurrentTime ? player.getCurrentTime() : 0) || 0;
                            player.loadVideoById(videoId, Math.max(0, currentTime));
                        }
                    }
                } catch (err) {
                    console.error('[VT] music mode reload failed', err);
                }
                return false;
            }
            return c;
        });

        document.addEventListener('vt-config-update', function () {
            var wasEnabled = enabled;
            featureEnabled = getConfig('features_enabled') === true && getConfig('music_mode_feature') === true;
            enabled = featureEnabled && getConfig('music_mode') === true;
            if (wasEnabled !== enabled) {
                if (!enabled) lastThumbnail = null;
            }
        });
    })();

    // ------------------------------------------------------------------
    // MODULE: touch overlay (+ gear, volume buttons)
    // ------------------------------------------------------------------
    (function () {
        function simulateKeyDown(keyCode) {
            var event = new Event('keydown');
            event.keyCode = keyCode;
            document.dispatchEvent(event);
        }

        function simulateKeyUp(keyCode) {
            var event = new Event('keyup');
            event.keyCode = keyCode;
            document.dispatchEvent(event);
        }

        function getButtonSize() {
            var aspectClass = window.__vtAspectClass || 'normal';
            var base = {
                'normal': 52,
                'ultra-wide': 44,
                'ultra-tall': 44,
                'squareish': 56
            }[aspectClass] || 52;
            return Math.max(36, Math.min(68, base));
        }

        function createCircularButton(text, keyCode, onTap, onRelease, extraStyle) {
            var buttonSize = getButtonSize();
            var button = document.createElement('div');
            button.style.display = 'inline-flex';
            button.style.justifyContent = 'center';
            button.style.alignItems = 'center';
            button.style.width = buttonSize + 'px';
            button.style.height = buttonSize + 'px';
            button.style.backgroundColor = '#272727';
            button.style.opacity = '0.9';
            button.style.borderRadius = '50%';
            button.style.color = 'white';
            button.style.fontWeight = 'bold';
            button.style.userSelect = 'none';
            button.style.pointerEvents = 'auto';
            button.style.verticalAlign = 'middle';

            // Scale font size proportionally
            var fontSize = Math.round(buttonSize * 0.42);
            button.style.fontSize = fontSize + 'px';

            if (extraStyle) Object.assign(button.style, extraStyle);
            button.textContent = text;

            button.addEventListener('touchstart', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (onTap) onTap();
            }, { passive: false });

            button.addEventListener('touchend', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (onRelease) onRelease();
                if (keyCode != null) simulateKeyUp(keyCode);
            }, { passive: false });

            if (keyCode != null) {
                button.addEventListener('touchstart', function () { simulateKeyDown(keyCode); });
            }

            return button;
        }

        function createGear() {
            var gear = createCircularButton('\\u2699', null, function () {
                try { if (window.Android) window.Android.openSettings(); } catch (_) {}
            });
            gear.style.position = 'absolute';
            gear.style.top = '12px';
            gear.style.right = '12px';
            gear.style.zIndex = '999999';
            gear.style.width = getButtonSize() + 'px';
            gear.style.height = getButtonSize() + 'px';
            gear.style.fontSize = Math.round(getButtonSize() * 0.42) + 'px';
            gear.style.pointerEvents = 'auto';
            return gear;
        }

        if (getConfig('mode') === 'web' || getConfig('touch_overlay') === false) {
            // On the normal YouTube web page (portrait) keep just a small settings gear:
            // the TV dpad/blurs would clash with the regular mobile UI.
            waitForCondition(function () { return !!document.body; }).then(function () {
                var gear = createGear();
                document.body.appendChild(gear);
            });
            return;
        }

        waitForCondition(function () { return !!document.body; }).then(function () {
            if (window.tectonicConfig && window.tectonicConfig.featureSwitches) {
                window.tectonicConfig.featureSwitches.enableTouchSupport = true;
            } else {
                tectonicConfigOverrides.push({ featureSwitches: { enableTouchSupport: true } });
            }

            window.addEventListener('keydown', function (e) {
                if (e.code === 'Space') e.preventDefault();
            });

            var touchKeyCodeMap = {
                'back': 32769, 'select': 32768, 'up': 32785, 'down': 32786, 'left': 32787, 'right': 32788
            };

            var controls = document.createElement('div');

            function position() {
                controls.style.cssText = [
                    'position:fixed;top:0;left:0;right:0;bottom:0;z-index:999990;pointer-events:none;'
                ].join(' ');
            }
            position();
            controls.style.pointerEvents = 'none';

            function createGearButton() {
                var gear = createCircularButton('\u2699', null, function () {
                    try { if (window.Android) window.Android.openSettings(); } catch (_) {}
                });
                gear.style.position = 'absolute';
                gear.style.top = '16px';
                gear.style.right = '16px';
                gear.style.width = '48px';
                gear.style.height = '48px';
                gear.style.fontSize = '22px';
                return gear;
            }

            function makeCluster(horizontal, bottom) {
                var cluster = document.createElement('div');
                cluster.style.position = 'absolute';
                cluster.style.bottom = bottom;
                cluster.style[horizontal] = '24px';
                cluster.style.whiteSpace = 'nowrap';
                cluster.style.pointerEvents = 'none';
                return cluster;
            }

            var leftCluster = makeCluster('left', '48px');
            var rightCluster = makeCluster('right', '48px');

            function dpad(iconCode, keyCode, rotation) {
                var btn = createCircularButton(iconCode, keyCode);
                btn.style.marginLeft = '8px';
                if (rotation) btn.style.transform = 'rotate(' + rotation + 'deg)';
                return btn;
            }

            leftCluster.appendChild(dpad('\u25C4', touchKeyCodeMap.left));
            leftCluster.appendChild(dpad('\u25BA', touchKeyCodeMap.right));
            leftCluster.appendChild(dpad('\u25B2', touchKeyCodeMap.up));
            leftCluster.appendChild(dpad('\u25BC', touchKeyCodeMap.down));

            rightCluster.appendChild(createCircularButton('\u2212', null, null, null, { fontSize: '28px' }));
            rightCluster.lastChild.__vtTap = function () {
                var e = new Event('keydown');
                e.key = '-';
                e.keyCode = 189;
                document.dispatchEvent(e);
            };
            rightCluster.lastChild.addEventListener('touchstart', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                if (this.__vtTap) this.__vtTap();
            }, { passive: false });

            rightCluster.appendChild(createCircularButton('M', null));
            rightCluster.lastChild.__vtTap = function () {
                var e = new Event('keydown');
                e.key = 'm';
                e.keyCode = 77;
                document.dispatchEvent(e);
            };
            rightCluster.lastChild.addEventListener('touchstart', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                if (this.__vtTap) this.__vtTap();
            }, { passive: false });
            rightCluster.lastChild.style.fontSize = '18px';

            rightCluster.appendChild(createCircularButton('\u002B', null));
            rightCluster.lastChild.__vtTap = function () {
                var e = new Event('keydown');
                e.key = '+';
                e.keyCode = 187;
                document.dispatchEvent(e);
            };
            rightCluster.lastChild.addEventListener('touchstart', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                if (this.__vtTap) this.__vtTap();
            }, { passive: false });
            rightCluster.lastChild.style.fontSize = '26px';

            controls.appendChild(leftCluster);
            controls.appendChild(rightCluster);
            controls.appendChild(createGearButton());

            document.body.appendChild(controls);

            var visible = false;
            var lastTouch = 0;

            function hide() {
                leftCluster.style.display = 'none';
                rightCluster.style.display = 'none';
                visible = false;
            }

            function show() {
                leftCluster.style.display = '';
                rightCluster.style.display = '';
                visible = true;
            }

            hide();

            setInterval(function () {
                if (!visible) return;
                if ((Date.now() - lastTouch) >= 4000) hide();
            }, 250);

            window.addEventListener('touchstart', function (e) {
                lastTouch = Date.now();
                if (!visible) {
                    e.preventDefault();
                    show();
                }
                setTimeout(hide, 5000);
            }, { passive: false });
        });
    })();

    // ------------------------------------------------------------------
    // userstyles (custom CSS files)
    // ------------------------------------------------------------------
    (function () {
        function applyUserstyles() {
            if (!window.Android || !getConfig('userstyles')) {
                if (document.getElementById('vt-userstyle-css')) {
                    document.getElementById('vt-userstyle-css').remove();
                }
                return;
            }

            var json = window.Android.getUserstyles();
            var styles;
            try {
                styles = JSON.parse(json);
            } catch (_) { return; }

            var disabled = getConfig('disabled_userstyles') || [];
            var text = styles
                .filter(function (s) { return !disabled.includes(s.filename); })
                .map(function (s) { return s.css; })
                .join('\n');

            var style = document.getElementById('vt-userstyle-css');
            if (!style) {
                style = document.createElement('style');
                style.id = 'vt-userstyle-css';
                style.type = 'text/css';
                var append = function () {
                    if (document.head) document.head.appendChild(style);
                };
                if (document.head) append();
                else waitForCondition(function () { return !!document.head; }).then(append);
            }
            style.textContent = text;
        }

        waitForCondition(function () { return !!document.body; }).then(function () {
            applyUserstyles();
        });

        document.addEventListener('vt-config-update', function () {
            applyUserstyles();
        });
    })();
})();