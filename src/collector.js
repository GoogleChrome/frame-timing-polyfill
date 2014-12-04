// Copyright (c) 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';


(function() {
  if (window.web_smoothness && window.web_smoothness.FrameTimingDataCollector)
    return;
  if (!window.web_smoothness)
    window.web_smoothness = {};

  var QUIESENCE_TIMEOUT_MS = 500;

  var HISTORY_LENGTH_MS = 15000;

  /*
   * We need setImmediate in order to schedule a task right after the
   * commit yields. setTimeout(,0) has a 1-2ms gap, and mutation observers
   * actually push out rendering.
   */
  function createSetImmediateFunction(window) {
    var queue = [];
    window.addEventListener('message', function(m) {
      if (!m.data.drainPlease)
        return;

      var toProcess = queue.slice();
      queue = [];
      toProcess.forEach(function(tuple) {
        tuple[0].call(tuple[1], tuple[2], tuple[3]);
      });
    })

    function setImmediate(callback, binding, arg0, arg1) {
      queue.push([callback, binding, arg0, arg1]);
      if (queue.length == 1)
        window.postMessage({drainPlease: true}, '*');
    }
    return setImmediate;
  }


  /**
   * @constructor
   */
  function PerformanceRenderEntry() {
    this.name = 'requestAnimationFrame';
    this.entryType = 'render';
    this.startTime = 0;
    this.duration = 0;
    this.sourceFrame = 0;
  }


  var nextRAFNumber = 0;


  /**
   * Simple rAF-based perf monitoring used when window.performance doesn't
   * support draw and commit timings.
   *
   * @constructor
   */
  function RAFBasedDataCollector(window, opt_bufferSize) {
    this.maxBufferSize_ = opt_bufferSize || 60;

    this.listeners_ = {'full' : [],
                       'called': []};

    this.enabled_ = false;
    this.events_ = [];
    this.raf_ = this.raf_.bind(this);
    this.window_ = window;
    this.setImmediate_ = createSetImmediateFunction(this.window_);
  }

  RAFBasedDataCollector.prototype = {
    get enabled() {
      return this.enabled_;
    },

    set enabled(enabled) {
      enabled = !!enabled;
      if (this.enabled_ == enabled)
        return;
      this.enabled_ = enabled;
      if (this.enabled_)
        this.window_.requestAnimationFrame(this.raf_);
    },

    raf_: function(frameBeginTime) {
      if (!this.enabled_)
        return;

      this.dispatchEvent('called');

      var sourceFrame = nextRAFNumber++;

      // The mostly-correct time to measure the commit in Chrome is right
      // after the main thread regains control after committing to the
      // compositor thread.
      //
      // TODO(nduca): See how it behaves on other browsers.
      //
      // Note: setTimeout doesn't work --- there's a ~1ms gap between the post
      // and the task firing.

      //setTimeout(this.measure_.bind(this, sourceFrame, frameBeginTime), 0);
      this.setImmediate_(this.measure_, this, sourceFrame, frameBeginTime);

      if (this.enabled_)
        this.window_.requestAnimationFrame(this.raf_);
    },

    measure_: function(sourceFrame, frameBeginTime) {
      var now = this.window_.performance.now();
      if (this.events_.length < this.maxBufferSize_) {
        var e = new PerformanceRenderEntry();
        e.sourceFrame = sourceFrame;
        e.startTime = frameBeginTime;
        e.duration = now - frameBeginTime;
        this.events_.push(e);
      }

      if (this.events_.length >= this.maxBufferSize_)
        this.dispatchEvent('full');
    },

    clearEvents: function() {
      this.events_ = [];
    },

    getEvents: function() {
      return this.events_;
    },

    addEventListener: function(name, cb) {
      if (!this.listeners_[name])
        throw new Error('Unsupported: ' + name);
      this.listeners_[name].push(cb);
    },

    removeEventListener: function(name, cb) {
      if (!this.listeners_[name])
        throw new Error('Unsupported: ' + name);
      var i = this.listeners_[name].indexOf(cb);
      if (i == -1)
        throw new Error('Not found');
      this.listeners_[name].splice(i, 1);
    },

    dispatchEvent: function(name) {
      this.listeners_[name].forEach(function(listener) {
        listener.call(this.window_);
      }, this);
    }
  };

  function FrameTimingInfoForRange(
      opt_rafEvents,
      opt_commitEvents, opt_compositeEvents) {
    /* Baic information: we report frame intervals instead of frame rate because
     * of how human minds perceive log scales.
     *
     * Think miles-per-gallon vs gallons-per-mile.
     *
     * When we see 14ms vs 16.66ms frame times, we think hmm
     * thats a little bit bigger. But when you see 60fps to 71fps, people
     * almost always get confused and think the change is bigger.
     */
    this.measuredTimeRange = undefined;
    this.startTime = undefined;
    this.endTime = undefined;

    // frameIntervalMs is commit rate without the frame timing api, but is
    // draw rate with it present.
    this.frameIntervalMs = undefined;

    // Details on main thread commit rate. Always available but noisy
    // without frame timing api.
    this.rafIntervalMs = undefined;

    // Details on actual true screen fps. Undefined when frame timing api is not
    // available.
    this.commitIntervalMs = undefined;
    this.drawIntervalMs = undefined;
    this.drawsPerCommit = undefined;

    // The high-precision stream for applications which require it.
    this.frameIntervalsForRange = [];

    //Private

    // The raw event stream
    this.rafEvents_ = opt_rafEvents || [];
    this.commitEvents_ = opt_commitEvents || [];
    this.compositeEvents_ = opt_compositeEvents || [];

    this.calculate_();
  }
  FrameTimingInfoForRange.prototype = {
    addMoreInfo: function(info, opt_historyLengthMs, opt_now) {
      if (!(info instanceof FrameTimingInfoForRange))
        throw new Error('Must be info');

      Array.prototype.push.apply(this.rafEvents_, info.rafEvents_);
      Array.prototype.push.apply(this.commitEvents_, info.commitEvents_);
      Array.prototype.push.apply(this.compositeEvents_, info.compositeEvents_);

      if (opt_historyLengthMs !== undefined)
        this.purgeOldEvents_(opt_historyLengthMs, opt_now);

      this.calculate_();
    },

    purgeOldEvents_: function(historyLengthMs, opt_now) {
      var now = opt_now || window.performance.now();
      var retirementTimestamp = now - historyLengthMs;
      function isStillCurrent(e) {
        return e.startTime + e.duration >= retirementTimestamp;
      }
      this.rafEvents_ = this.rafEvents_.filter(isStillCurrent);
      this.commitEvents_ = this.commitEvents_.filter(isStillCurrent);
      this.compositeEvents_ = this.compositeEvents_.filter(isStillCurrent);
    },

    getBounds_: function() {
      var min = Number.MAX_VALUE;
      var max = -Number.MAX_VALUE;
      for (var i = 0; i < this.rafEvents_.length; i++) {
        var e = this.rafEvents_[i];
        if (e.startTime < min) min = e.startTime;
        if (e.startTime + e.duration > max) max = e.startTime + e.duration;
      }
       for (var i = 0; i < this.compositeEvents_.length; i++) {
        var e = this.compositeEvents_[i];
        if (e.startTime < min) min = e.startTime;
        if (e.startTime + e.duration > max) max = e.startTime + e.duration;
      }
      if(min === Number.MAX_VALUE || max === -Number.MAX_VALUE)
        return {
          min: undefined,
          max: undefined,
          range: undefined
        };
      return {
        min: min,
        max: max,
        range: max - min
      };
    },

    computeCurrentFramesFromCurrentData_: function() {
      function Frame(commitEvent) {
        this.commitEvent = commitEvent;
        this.drawEvents = [];
      }
      var framesBySourceFrame = {};
      this.commitEvents_.forEach(function(e) {
        if (framesBySourceFrame[e.sourceFrame]){
          return;
        }
        framesBySourceFrame[e.sourceFrame] = new Frame(e);
      });

      this.compositeEvents_.forEach(function(e) {
        // The compositor may be drawing a frame whose commit event we long-ago
        // threw away.
        if (!framesBySourceFrame[e.sourceFrame])
          return;
        framesBySourceFrame[e.sourceFrame].drawEvents.push(e);
      });

      var frames = [];
      for (var sourceFrame in framesBySourceFrame)
        frames.push(framesBySourceFrame[sourceFrame]);
      return frames;
    },

    calculate_: function() {
      var bounds = this.getBounds_();
      this.measuredTimeRange = bounds.range;
      this.startTime = bounds.min;
      this.endTime = bounds.max;

      if (bounds.range === undefined) {
        return;
      }
      return this.rafEvents_.length ? this.calculateRaf_() :
          this.calculateFrameTiming_();
    },

    findIntervals_: function(v, i, a) {
      if(this.last === undefined) {
        this.last = v.startTime;
        return;
      }
      var et = v.startTime - this.last;
      this.last = v.startTime;
      return {time: v.startTime, intervalMs: et};
    },

    calculateRaf_: function() {
      // rafIntervalMs.
      if (this.rafEvents_.length) {
        this.rafIntervalMs = this.measuredTimeRange / this.rafEvents_.length;
      }
      this.frameIntervalsForRange = this.rafEvents_.map(
          this.findIntervals_, {last: undefined});
      this.frameIntervalsForRange.splice(0,1);
      this.frameIntervalMs = this.rafIntervalMs;
    },

    calculateFrameTiming_: function() {
      // commitIntervalMs.
      if (this.commitEvents_.length) {
        this.commitIntervalMs = this.measuredTimeRange /
            this.commitEvents_.length;
      } else {
        this.commitIntervalMs = 0;
      }

      // drawIntervalMs.
      if (this.compositeEvents_.length) {
        this.drawIntervalMs = this.measuredTimeRange /
            this.compositeEvents_.length;
      } else {
        this.drawIntervalMs = 0;
      }
      this.frameIntervalsForRange = this.compositeEvents_.map(
          this.findIntervals_, {last: undefined});
      this.frameIntervalsForRange.splice(0,1);

      // drawsPerCommit.
      var numDraws = 0;
      var frames = this.computeCurrentFramesFromCurrentData_();
      if (frames.length) {
        frames.forEach(function(f) {
          numDraws += f.drawEvents.length;
        });
        this.drawsPerCommit = numDraws / frames.length;
      }

      this.frameIntervalMs = this.drawIntervalMs;
    }

  };

  var instance_ = [];

  /**
   * Infrastructure for monitoring frame timing related statistics, both
   * overall and for specific interactions.
   *
   * @constructor
   */
  function FrameTimingDataCollector (opt_window, opt_document) {
    this.window_ = opt_window || window;
    this.document_ = opt_document || document;

    if (instance_[this.window_])
      throw new Error('Get FrameTimingDataCollector via FrameTimingDataCollector.getInstance()');

    this.pageVisibilityChanged_ = this.onPageVisibilityChanged_.bind(this);
    this.onQuiesenceTimeout_ = this.onQuiesenceTimeout_.bind(this);
    this.onRafBufferFull_ = this.onRafBufferFull_.bind(this);
    this.onFrameTimingBufferFull_ = this.onFrameTimingBufferFull_.bind(this);
    this.handleEventTrigger_ = this.handleEventTrigger_.bind(this);

    this.hasFrameTimingApi_ = this.window_.PerformanceRenderTiming !== undefined;

    if (!this.hasFrameTimingApi_) {
      this.rafCommitMonitor_ = new RAFBasedDataCollector(this.window_);
      this.rafCommitMonitor_.addEventListener('full', this.onRafBufferFull_);
    } else {
      this.rafCommitMonitor_ = undefined;
    }

    // Listeners, etc.
    this.listeners_ = {'got-data' : [],
                       'did-quiesce' : [],
                       'cancel-promises' : [] };

    // Raw data.
    this.enabled_ = 0;
    this.historyLengthMs_ = 15000;
    this.currentQuiesenceTimeout_ = undefined;
    this.rafCommitEvents_ = [];
    this.compositorCommitEvents_ = [];
    this.compositorDrawEvents_ = [];
  }

  FrameTimingDataCollector.getInstance = function(opt_window) {
    var win = opt_window || window;
    if (!instance_[win])
      instance_[win] = new FrameTimingDataCollector(win);
    return instance_[win];
  };

  FrameTimingDataCollector.destroyInstance = function(opt_window) {
    var win = opt_window || window;
    if (instance_[win])
      instance_[win].destroy(win);
  };

  FrameTimingDataCollector.prototype = {
    destroy: function(win) {
      while (this.enabled)
        this.decEnabledCount();
      instance_[win] = undefined;
    },

    get enabled() {
      return this.enabled_ > 0;
    },

    incEnabledCount: function() {
      ++this.enabled_;
      if (this.enabled_ != 1)
        return;

      this.rafCommitEvents_ = [];
      this.compositorCommitEvents_ = [];
      this.compositorDrawEvents_ = [];

      if (!this.hasFrameTimingApi_) {
        this.rafCommitMonitor_.enabled = true;
      } else {
        this.window_.performance.addEventListener(
            'webkitframetimingbufferfull', this.onFrameTimingBufferFull_);
        this.window_.performance.webkitSetFrameTimingBufferSize(1);
      }
      this.document_.addEventListener('visibilitychange',
                                      this.pageVisibilityChanged_);
    },

    decEnabledCount: function() {
      if (this.enabled_ == 0)
        throw new Error('Error disabling monitor: not enabled');

      --this.enabled_;
      if (this.enabled_ != 0)
        return;

      this.document_.removeEventListener('visibilitychange',
                                         this.pageVisibilityChanged_);

      if (!this.hasFrameTimingApi_) {
        this.rafCommitMonitor_.enabled = false;
      } else {
        this.window_.performance.removeEventListener(
            'webkitframetimingbufferfull', this.onFrameTimingBufferFull_);
      }

      if (this.currentQuiesenceTimeout_) {
        this.window_.clearTimeout(this.currentQuiesenceTimeout_);
        this.currentQuiesenceTimeout_ = undefined;
      }
    },

    get supportsFrameTimingEvents() {
      return this.hasFrameTimingApi_;
    },

    addEventListener: function(name, cb) {
      if (!this.listeners_[name])
        throw new Error('Unsupported: ' + name);
      this.listeners_[name].push(cb);
    },

    removeEventListener: function(name, cb) {
      if (!this.listeners_[name])
        throw new Error('Unsupported: ' + name);
      var i = this.listeners_[name].indexOf(cb);
      if (i == -1)
        throw new Error('Not found');
      this.listeners_[name].splice(i, 1);
    },

    dispatchEvent: function(name) {
      this.listeners_[name].forEach(function(listener) {
        listener.call(this.window_);
      }, this);
    },

    forceCollectEvents: function() {
      this.handleEventTrigger_();
    },

    onRafBufferFull_: function() {
      this.handleEventTrigger_();
    },

    onFrameTimingBufferFull_: function() {
      var didGetEvents = this.handleEventTrigger_();
      if (didGetEvents) {
        this.window_.performance.webkitSetFrameTimingBufferSize(150);
      }
    },

    handleEventTrigger_: function() {
      var didGetEvents = this.collectEvents_();
      if (didGetEvents) {
        this.dispatchEvent('got-data');
        this.renewQuiescenceTimeout_();
      }
      return didGetEvents;
    },

    collectEvents_: function() {
      var didGetEvents = false;

      if (this.rafCommitMonitor_ && this.rafCommitMonitor_.enabled) {
        var events = this.rafCommitMonitor_.getEvents();
        this.rafCommitEvents_.push.apply(this.rafCommitEvents_, events);

        this.rafCommitMonitor_.clearEvents();

        didGetEvents = events.length > 0;
      }

      if(this.hasFrameTimingApi_) {
        var commitEvents = this.window_.performance.getEntriesByType("render");
        var drawEvents = this.window_.performance.getEntriesByType("composite");

        this.compositorCommitEvents_.push.apply(
            this.compositorCommitEvents_, commitEvents);
        this.compositorDrawEvents_.push.apply(
            this.compositorDrawEvents_, drawEvents);

        this.window_.performance.webkitClearFrameTimings();

        didGetEvents = didGetEvents || commitEvents.length > 0
            || drawEvents.length > 0;
      }

      this.purgeOldEvents_();
      return didGetEvents;
    },

    renewQuiescenceTimeout_: function() {
      // Quiesence based on timeouts isn't supported in raf mode. The issue is
      // we can't tell apart rAFs that do nothing from rAFs that do real work.
      if (!this.hasFrameTimingApi_)
        return;

      if (this.currentQuiesenceTimeout_) {
        this.window_.clearTimeout(this.currentQuiesenceTimeout_);
      }
      this.currentQuiesenceTimeout_ = this.window_.setTimeout(
          this.onQuiesenceTimeout_, QUIESENCE_TIMEOUT_MS);
    },

    onQuiesenceTimeout_: function() {
      this.currentQuiesenceTimeout_ = undefined;
      this.onQuiesence_();
    },

    onPageVisibilityChanged_: function() {
      if (document.visibilityState === 'hidden' ||
          document.visibilityState === 'unloaded') {
        this.dispatchEvent('cancel-promises');
        if (this.currentQuiesenceTimeout_) {
          this.window_.clearTimeout(this.currentQuiesenceTimeout_);
          this.currentQuiesenceTimeout_ = undefined;
        }
        this.onQuiesence_();
      }
    },

    onQuiesence_: function() {
      var didGetEvents = this.handleEventTrigger_();
      if (didGetEvents)
        return;
      this.dispatchEvent('did-quiesce');
      if (this.hasFrameTimingApi_) {
        // Wait for the next event
        this.window_.performance.webkitSetFrameTimingBufferSize(1);
        this.window_.performance.webkitClearFrameTimings();
      }
      /* TODO(nduca): It seems right that we clear the saved events, but
       * its not 100% clear to me that this is the case. */
      this.compositorCommitEvents_ = [];
      this.compositorDrawEvents_ = [];
    },

    purgeOldEvents_: function(opt_now) {
      var now = opt_now !== undefined ? opt_now : this.window_.performance.now();
      var retirementTimestamp = now - this.historyLengthMs_;

      function f(e) {
        return e.startTime + e.duration >= retirementTimestamp;
      }
      this.rafCommitEvents_ = this.rafCommitEvents_.filter(f);
      this.compositorCommitEvents_ = this.compositorCommitEvents_.filter(f);
      this.compositorDrawEvents_ = this.compositorDrawEvents_.filter(f);
    },

    /**
     * Gets a FrameTimingInfoForRange for the currently recorded amount of time
     */
    get overallFrameTimingInfo() {
      return new FrameTimingInfoForRange(this.rafCommitEvents_,
                                        this.compositorCommitEvents_,
                                        this.compositorDrawEvents_);
    },

    getOverallFrameTimingInfoSinceTime: function(startTime) {
      function f(e) {
        return e.startTime + e.duration > startTime;
      }
      return new FrameTimingInfoForRange(this.rafCommitEvents_.filter(f),
                                        this.compositorCommitEvents_.filter(f),
                                        this.compositorDrawEvents_.filter(f));
    },

    /* Returns promise that, when resolved, will tell time of the draw of the
     * first frame, as measured by requestAnimationFrame or frame timing if
     * present.
     * E.g.:
     *   element.addEventListener('click', function() {
     *     montior.requestFirstFramePromise().then(function(elapsedTime) {
     *       console.log("TTFS: ", elapsedTime);
     *     })
     *   });
     *
     * Note: this promise really can fail. When the page goes invisible,
     * for instance.
     */
    requestFirstFramePromise: function() {
      return this.hasFrameTimingApi_ ?
          this.requestFirstFramePromiseUsingFrameTiming_() :
          this.requestFirstFramePromiseUsingRAF_();
    },

    requestFirstFramePromiseUsingRAF_: function () {
      return new Promise(function(resolve, reject) {
        var startTime = this.window_.performance.now();

        var cancelRafPromise = function() {
          this.removeEventListener('cancel-promises', cancelRafPromise);
          reject(new Error("Page visibility changed"));
        }.bind(this);
        this.addEventListener('cancel-promises', cancelRafPromise);

        this.window_.requestAnimationFrame(function() {
          this.window_.requestAnimationFrame(function() {
            this.removeEventListener('cancel-promises', cancelRafPromise);
            resolve(this.window_.performance.now() - startTime);
          }.bind(this));
        }.bind(this));
      }.bind(this));
    },

    requestFirstFramePromiseUsingFrameTiming_: function () {
      return new Promise(function(resolve, reject) {
        var targetCommitEvent;
        var startTime = this.window_.performance.now();
        var frameTimingCallback;
        this.incEnabledCount();

        var cancelFrameTimingPromise = function() {
          this.removeEventListener('cancel-promises', cancelFrameTimingPromise);
          this.removeEventListener('got-data', frameTimingCallback);
          this.decEnabledCount();
          reject(new Error("Page visibility changed"));
        }.bind(this);
        this.addEventListener('cancel-promises', cancelFrameTimingPromise);

        frameTimingCallback = function() {
          if (!targetCommitEvent) {
            for(var i = 0; i < this.compositorCommitEvents_.length; ++i) {
              if (this.compositorCommitEvents_[i].startTime > startTime) {
                targetCommitEvent = this.compositorCommitEvents_[i];
                break;
              }
            }
          }
          if (!targetCommitEvent) {
            return;
          }
          var targetFrame = targetCommitEvent.sourceFrame;
          for (var j = 0; j < this.compositorDrawEvents_.length; ++j) {
            if (this.compositorDrawEvents_[j].sourceFrame >= targetFrame) {
              this.removeEventListener('cancel-promises',
                                       cancelFrameTimingPromise);
              this.removeEventListener('got-data', frameTimingCallback);
              this.decEnabledCount();
              resolve(this.compositorDrawEvents_[j].startTime - startTime);
            }
          }
        }.bind(this);

        this.addEventListener('got-data', frameTimingCallback);
        this.renewQuiescenceTimeout_();
      }.bind(this));
    }
  };

  window.web_smoothness.RAFBasedDataCollector = RAFBasedDataCollector;
  window.web_smoothness.FrameTimingDataCollector = FrameTimingDataCollector;
  window.web_smoothness.FrameTimingInfoForRange = FrameTimingInfoForRange;
})();
