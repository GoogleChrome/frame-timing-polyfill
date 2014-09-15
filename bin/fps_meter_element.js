/**
 * THIS FILE IS AUTOGENERATED BY Makefile, do not edit directly
 *
 */


// Copyright (c) 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';


(function() {
  if (window.web_smoothness && window.web_smoothness.SmoothnessDataCollector)
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
  function CompositorCommitPerformanceEntry() {
    this.name = 'requestAnimationFrame';
    this.entryType = 'smoothness';
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
        var e = new CompositorCommitPerformanceEntry();
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

  function SmoothnessInfoForRange(
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

    // frameIntervalMs is commit rate without the smoothness api, but is
    // draw rate with it present.
    this.frameIntervalMs = undefined;

    // Details on main thread commit rate. Always available but noisy
    // without smoothness api.
    this.rafIntervalMs = undefined;

    // Details on actual true screen fps. Undefined when smoothness api is not
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
  SmoothnessInfoForRange.prototype = {
    addMoreInfo: function(info, opt_historyLengthMs, opt_now) {
      if (!(info instanceof SmoothnessInfoForRange))
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
      for (var i = 0; i < this.commitEvents_.length; i++) {
        var e = this.commitEvents_[i];
        if (e.startTime < min) min = e.startTime;
        if (e.startTime + e.duration > max) max = e.startTime + e.duration;
      }
      for (var i = 0; i < this.compositeEvents_.length; i++) {
        var e = this.compositeEvents_[i];
        if (e.startTime < min) min = e.startTime;
        if (e.startTime + e.duration > max) max = e.startTime + e.duration;
      }
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
      if (bounds.range === -Infinity) {
        return;
      }
      return this.rafEvents_.length ? this.calculateRaf_() :
          this.calculateSmoothness_();
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

    calculateSmoothness_: function() {
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

  var instance_ = undefined;

  /**
   * Infrastructure for monitoring smoothness related statistics, both
   * overall and for specific interactions.
   *
   * @constructor
   */
  function SmoothnessDataCollector (opt_window, opt_document) {
    this.window_ = opt_window || window;
    this.document_ = opt_document || document;

    if (instance_)
      throw new Error('Get SmoothnessDataCollector via SmoothnessDataCollector.getInstance()');

    this.pageVisibilityChanged_ = this.onPageVisibilityChanged_.bind(this);
    this.onQuiesenceTimeout_ = this.onQuiesenceTimeout_.bind(this);
    this.onRafBufferFull_ = this.onRafBufferFull_.bind(this);
    this.onSmoothnessBufferFull_ = this.onSmoothnessBufferFull_.bind(this);
    this.handleEventTrigger_ = this.handleEventTrigger_.bind(this);

    this.hasSmoothnessApi_ = this.window_.PerformanceSmoothnessTiming !== undefined;

    if (!this.hasSmoothnessApi_) {
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

  SmoothnessDataCollector.getInstance = function() {
    if (!instance_)
      instance_ = new SmoothnessDataCollector();
    return instance_;
  };

  SmoothnessDataCollector.destroyInstance = function() {
    if (instance_)
      instance_.destroy();
  };

  SmoothnessDataCollector.prototype = {
    destroy: function() {
      if (this.enabled_)
        this.enabled = false;
      instance_ = undefined;
    },

    get enabled() {
      return this.enabled_ > 0;
    },

    set enabled(enabled) {
      if (!enabled && this.enabled_ == 0)
        throw new Error('Error disabling monitor: not enabled');

      this.enabled_ += (enabled ? 1 : -1);
      if ((enabled && this.enabled_ != 1) || (!enabled && this.enabled_ != 0))
        return;

      if (enabled) {
        this.rafCommitEvents_ = [];
        this.compositorCommitEvents_ = [];
        this.compositorDrawEvents_ = [];

        if (!this.hasSmoothnessApi_) {
          this.rafCommitMonitor_.enabled = true;
        } else {
          this.window_.performance.addEventListener(
            'webkitsmoothnesstimingbufferfull', this.onSmoothnessBufferFull_);
          this.window_.performance.webkitSetSmoothnessTimingBufferSize(1);
        }
        this.document_.addEventListener('visibilitychange',
                                        this.pageVisibilityChanged_);
      } else {

        this.document_.removeEventListener('visibilitychange',
                                           this.pageVisibilityChanged_);

        if (!this.hasSmoothnessApi_) {
          this.rafCommitMonitor_.enabled = false;
        } else {
          this.window_.performance.removeEventListener(
            'webkitsmoothnesstimingbufferfull', this.onSmoothnessBufferFull_);
        }

        if (this.currentQuiesenceTimeout_) {
          this.window_.clearTimeout(this.currentQuiesenceTimeout_);
          this.currentQuiesenceTimeout_ = undefined;
        }
      }
    },

    get supportsSmoothnessEvents() {
      return this.hasSmoothnessApi_;
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

    onSmoothnessBufferFull_: function() {
      var didGetEvents = this.handleEventTrigger_();
      if (didGetEvents) {
        this.window_.performance.webkitSetSmoothnessTimingBufferSize(150);
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

      if(this.hasSmoothnessApi_) {
        var commitEvents = this.window_.performance.getEntriesByName(
            "commit", "smoothness");
        var drawEvents = this.window_.performance.getEntriesByName(
            "composite", "smoothness");

        this.compositorCommitEvents_.push.apply(
            this.compositorCommitEvents_, commitEvents);
        this.compositorDrawEvents_.push.apply(
            this.compositorDrawEvents_, drawEvents);

        this.window_.performance.webkitClearSmoothnessTimings();

        didGetEvents = didGetEvents || commitEvents.length > 0
            || drawEvents.length > 0;
      }

      this.purgeOldEvents_();
      return didGetEvents;
    },

    renewQuiescenceTimeout_: function() {
      // Quiesence based on timeouts isn't supported in raf mode. The issue is
      // we can't tell apart rAFs that do nothing from rAFs that do real work.
      if (!this.hasSmoothnessApi_)
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
      if (this.hasSmoothnessApi_) {
        // Wait for the next event
        this.window_.performance.webkitSetSmoothnessTimingBufferSize(1);
        this.window_.performance.webkitClearSmoothnessTimings();
      }
      /* TODO(nduca): It seems right that we clear the saved events, but
       * its not 100% clear to me that this is the case. */
      this.compositorCommitEvents_ = [];
      this.compositorDrawEvents_ = [];
    },

    purgeOldEvents_: function(opt_now) {
      var now = opt_now !== undefined ? opt_now : this.window_.performance.now();
      var retirementTimestamp = now - this.historyLengthMs_;

      function isStillCurrent(e) {
        return e.startTime + e.duration >= retirementTimestamp;
      }
      this.rafCommitEvents_ = this.rafCommitEvents_.filter(
          isStillCurrent);
      this.compositorCommitEvents_ = this.compositorCommitEvents_.filter(
          isStillCurrent);
      this.compositorDrawEvents_ = this.compositorDrawEvents_.filter(
          isStillCurrent);
    },

    /**
     * Gets a SmoothnessInfoForRange for the currently recorded amount of time
     */
    get overallSmoothnessInfo() {
      return new SmoothnessInfoForRange(this.rafCommitEvents_,
                                        this.compositorCommitEvents_,
                                        this.compositorDrawEvents_);
    },

    /* Returns promise that, when resolved, will tell time of the draw of the
     * first frame, as measured by requestAnimationFrame or smoothness if
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
      return this.hasSmoothnessApi_ ?
          this.requestFirstFramePromiseUsingSmoothness_() :
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

    requestFirstFramePromiseUsingSmoothness_: function () {
      return new Promise(function(resolve, reject) {
        var previousEnabledState = this.enabled;
        var targetCommitEvent;
        var startTime = this.window_.performance.now();
        var smoothnessCallback;
        this.enabled = true;

        var cancelSmoothnessPromise = function() {
          this.removeEventListener('cancel-promises', cancelSmoothnessPromise);
          this.removeEventListener('got-data', smoothnessCallback);
          this.enabled = previousEnabledState;
          reject(new Error("Page visibility changed"));
        }.bind(this);
        this.addEventListener('cancel-promises', cancelSmoothnessPromise);

        smoothnessCallback = function() {
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
                                       cancelSmoothnessPromise);
              this.removeEventListener('got-data', smoothnessCallback);
              this.enabled = previousEnabledState;
              resolve(this.compositorDrawEvents_[j].startTime - startTime);
            }
          }
        }.bind(this);

        this.addEventListener('got-data', smoothnessCallback);
        this.renewQuiescenceTimeout_();
      }.bind(this));
    }
  };

  window.web_smoothness.RAFBasedDataCollector = RAFBasedDataCollector;
  window.web_smoothness.SmoothnessDataCollector = SmoothnessDataCollector;
  window.web_smoothness.SmoothnessInfoForRange = SmoothnessInfoForRange;
})();
// Copyright (c) 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';


(function() {
  if (window.web_smoothness && window.web_smoothness.Monitor)
    return;
  if (!window.web_smoothness)
    window.web_smoothness = {};

   var HISTORY_LENGTH_MS = 15000;

  /*
   * Does this environment support PerformanceSmoothnessTiming events?
   * If not, fall back to using requestAnimationFrame to approximate.
   */
  function supportsSmoothnessEvents() {
    return web_smoothness.SmoothnessDataCollector.getInstance().
        supportsSmoothnessEvents;
  }

  /* Invoke 'cb' when a Smoothness event appears on the performance timeline,
   * or requestAnimationFrame monitoring fills the buffer.
   */
  function requestGotDataNotification(cb) {
    var cb_ = function() {
      web_smoothness.SmoothnessDataCollector.getInstance().
          removeEventListener('got-data', cb_);
      web_smoothness.SmoothnessDataCollector.getInstance().enabled = false;
      cb();
    };
    web_smoothness.SmoothnessDataCollector.getInstance().
        addEventListener('got-data', cb_);
    web_smoothness.SmoothnessDataCollector.getInstance().enabled = true;
  }

  /* Returns promise that, when resolved, will tell time of the draw of the
   * first frame, as measured by requestAnimationFrame or smoothness if
   * present.
   * E.g.:
   *   element.addEventListener('click', function() {
   *     web_smoothness.requestFirstFramePromise().then(function(elapsedTime) {
   *       console.log("TTFF: ", elapsedTime);
   *     })
   *   });
   *
   * Note: this promise really can fail. When the page goes invisible,
   * for instance.
   */
  function requestFirstFramePromise() {
    return web_smoothness.SmoothnessDataCollector.getInstance().
        requestFirstFramePromise();
  }

  /* Starts monitoring FPS for a specific range. Create one of these
   * when you start an animation, then call end() when you're done.
   * This lets you have per-animation monitoring of your application, useful
   * when one team member is working on a drawer system, while another team
   * member is working on the scrolling system.
   */
  function Monitor(opt_collector, opt_dataCallback, opt_historyLengthMs) {
    /* register with monitor for events */
    this.collector_ = opt_collector || SmoothnessDataCollector.getInstance();
    this.dataCallback_ = opt_dataCallback;
    this.historyLengthMs_ = opt_historyLengthMs || HISTORY_LENGTH_MS;

    this.dataHandler_ = this.dataHandler_.bind(this);
    this.quiesceHandler_ = this.quiesceHandler_.bind(this);
    this.endAndGetData_ = this.endAndGetData_.bind(this);

    this.currentSmoothnessInfo_ = new web_smoothness.SmoothnessInfoForRange();
    this.collector_.addEventListener('got-data', this.dataHandler_);
    this.collector_.addEventListener('did-quiesce', this.quiesceHandler_);
    this.collector_.enabled = true;
  }

  Monitor.prototype = {

    /*
     * Set the data callback to be used when Monitor.end() is
     * called.
     */
    set dataCallback(dataCallback) {
      this.dataCallback_ = dataCallback;
    },

    /*
     * Returns the current smoothness information up to this point
     */
    get smoothnessInfo() {
      if (this.collector_) {
        this.collector_.forceCollectEvents();
      }
      return this.currentSmoothnessInfo_;
    },

    /*
     * Stop monitoring and if Monitor was created with an
     * opt_dataCallback, or one was set via a call to set dataCallback,
     * invoke that callback with the collected data.
     */
    end: function() {
      this.endAndGetData_(this.dataCallback_);
    },

    /*
     * Stop monitoring. Do not call any callback with data.
     */
    abort: function() {
      this.endAndGetData_(function() {});
    },

    /*
     * Stop monitoring and invoke gotDataCallback with the collected data.
     */
    endAndGetData_: function(gotDataCallback) {
      if (!this.collector_){
        return;
      }
      /* wait until we see the current frame number make it up onscreen,
       * handling case where maybe when we call end() another frame isn't
       * necessarily coming.
       *
       * Then unregister with collector, and create SmoothnessInfoForRange for
       * the intervening time period, and pass to gotDataCallback.
       */
      if (gotDataCallback)
        gotDataCallback(this.smoothnessInfo);

      this.collector_.enabled = false;
      this.collector_.removeEventListener('got-data', this.dataHandler_);
      this.collector_.removeEventListener('did-quiesce', this.quiesceHandler_);
      this.collector_ = undefined;
    },

    dataHandler_: function() {
      var stats = this.collector_.overallSmoothnessInfo;
      if (stats)
        this.currentSmoothnessInfo_.addMoreInfo(stats, this.historyLengthMs_);
    },

    quiesceHandler_: function() {
      this.end();
    }
  };

  window.web_smoothness.Monitor = Monitor;
  window.web_smoothness.__defineGetter__('supportsSmoothnessEvents',
                                         supportsSmoothnessEvents);
  window.web_smoothness.requestGotDataNotification = requestGotDataNotification;
  window.web_smoothness.requestFirstFramePromise = requestFirstFramePromise;
})();
// Copyright (c) 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';


(function() {
  if (window.web_smoothness && window.web_smoothness.FPSMeter)
    return;
  if (!window.web_smoothness)
    window.web_smoothness = {};

  function FPSMeter() {
    var iframe = document.createElement('iframe');
    iframe.classList.add('fps-meter');
    iframe.__proto__ = FPSMeter.prototype;
    iframe.constuctor = FPSMeter;
    iframe.decorate();
    requestAnimationFrame(function(){
      iframe.onAttach();
    });
    return iframe;
  }

  FPSMeter.initWhenReady = function() {
    var search = window.location.search.substring(1);
    if (search.indexOf('fps') == -1)
      return;
    document.addEventListener('DOMContentLoaded', function() {
      if (document.body.querySelector('fps-meter'))
        return;
      document.body.appendChild(new FPSMeter());
    });
  }

  FPSMeter.prototype = {
    __proto__: HTMLDivElement.prototype,

    decorate: function() {
      this.classList.add('fps-meter');
    },

    onAttach: function() {
      var linkEl = this.contentDocument.createElement('link');
      linkEl.setAttribute('rel', 'stylesheet');
      linkEl.setAttribute('href', '../src/fps_meter_element.css');
      this.contentDocument.head.appendChild(linkEl);

      this.contentDocument.body.style.margin = '0px';
      this.contentDocument.body.appendChild(new FPSMeterElement(this.contentWindow));
    }
  }


  /**
   * @constructor
   */
  function FPSMeterElement(win) {
    var div = document.createElement('div');
    div.iframe_win = win;
    div.classList.add('fps-meter-element');
    div.__proto__ = FPSMeterElement.prototype;
    div.constuctor = FPSMeterElement;
    div.decorate();
    return div;
  }

  FPSMeterElement.prototype = {
    __proto__: HTMLDivElement.prototype,

    decorate: function() {
      this.classList.add('fps-meter-element');
      this.updateContents_ = this.updateContents_.bind(this);
      this.monitor_ = new web_smoothness.Monitor();
      web_smoothness.requestGotDataNotification(this.updateContents_);

      this.textBox_ = document.createElement('div');
      this.textBox_.className = 'text-box';
      this.textBox_.fpsLabel_ = document.createElement('span');
      this.textBox_.fpsLabel_.title='Frames per second';
      this.textBox_.fpsLabel_.style.color='blue';
      this.textBox_.appendChild(this.textBox_.fpsLabel_);
      this.textBox_.appendChild(document.createElement('br'));
      this.textBox_.cpsfLabel_ = document.createElement('span');
      this.textBox_.cpsfLabel_.title='Composites per source frame';
      this.textBox_.cpsfLabel_.style.color='red';
      this.textBox_.appendChild(this.textBox_.cpsfLabel_);
      this.textBox_.appendChild(document.createElement('br'));
      this.appendChild(this.textBox_);


      this.chartBox_ = document.createElement('div');
      this.chartBox_.className = 'chart-box';
      this.appendChild(this.chartBox_);

      this.chartData_ = [];

      this.setupGoogleChart_(this, this.chartOpts);
    },

    updateChartOptions_: function() {
      var rect = this.chartBox_.getBoundingClientRect();
      this.chartOptions_.width = rect.width - 1;
      this.chartOptions_.height = rect.height;
    },

    setupGoogleChart_: function() {
      this.chartOptions_ = {
        title:null,
        legend: {position:"none"},
        backgroundColor:"white",
        vAxes: {0: {title: null, ticks: [0,60,120]},
                1: {title: null, ticks: [0,100]}},
        hAxis: {title: null, ticks: []}
      };
      if (web_smoothness.supportsSmoothnessEvents) {
        this.chartOptions_.series = {
          0: {targetAxisIndex: 0, color:'blue'},
          1: {targetAxisIndex: 1, color:'orange'}
        }
      } else {
        this.chartOptions_.series = {
          0: {targetAxisIndex: 0, color:'blue'}
        }
      }
      this.updateChartOptions_();

      var gscript = document.createElement('script');
      gscript.setAttribute("type", "application/javascript");
      gscript.setAttribute("id", "XX-GMPlusGoogle-XX");
      document.head.appendChild(gscript);

      // event listener setup
      gscript.addEventListener("load",
          function changeCB(params) {
              gscript.removeEventListener("load", changeCB);
              google.load("visualization", "1", {packages:["corechart"],
                  "callback": function drawChart() {
                    this.chart_ = new google.visualization.LineChart(
                        this.chartBox_);
                  }.bind(this)
              });
          }.bind(this)
      );
      gscript.src = "http://www.google.com/jsapi";
    },

    updateContents_: function() {
      web_smoothness.requestGotDataNotification(this.updateContents_);
      var stats = this.monitor_.smoothnessInfo;
      if (!stats)
        return;
      var fps;
      if (stats.frameIntervalMs !== 0)
        fps = 1000 / stats.frameIntervalMs;
      else
        fps = 0;

      this.textBox_.fpsLabel_.innerText = "FPS: " + fps.toFixed(2);

      if (stats.drawsPerCommit) {
        this.textBox_.cpsfLabel_.innerText = "CPSF: " +
            stats.drawsPerCommit.toFixed(2);
        this.textBox_.cpsfLabel_.style.visibility = 'visible';
      } else {
        this.textBox_.cpsfLabel_.style.visibility = 'hidden';
      }

      // TODO(nduca): Compute this from the actual stored frame data, instead of
      // once a second.
      var now = window.performance.now();
      if (web_smoothness.supportsSmoothnessEvents) {
        if (this.chartData_.length == 0)
          this.chartData_.push(['Date', 'FPS', 'CPSF']);
        stats.frameIntervalsForRange.forEach(function(e) {
          this.chartData_.push([e.time, (e.intervalMs? 1000/e.intervalMs : 0),
                                stats.drawsPerCommit]);
        }.bind(this));
      } else {
        if (this.chartData_.length == 0)
          this.chartData_.push(['Date', 'FPS']);
        stats.frameIntervalsForRange.forEach(function(e) {
          this.chartData_.push([e.time, (e.intervalMs? 1000/e.intervalMs : 0)]);
        }.bind(this));
      }

      if (this.chartData_.length <= 1)
        return;

      this.chartData_.sort(function(a,b) { return a[0] - b[0]; });

      // Google Charts API wasn't happy with trying to plot 900 points into
      // a 200 pixel window for some reason. Lets try and collapse it down
      // a little.
      while (this.chartData_.length > 200) {
        var newChartData = [["Date","FPS","CPSF"]];
        for (var i = 1; i < (this.chartData_.length-1); i+=2) {
          var elem = [];
          for (var j = 0; j < 3; ++j) {
            elem.push((this.chartData_[i][j] + this.chartData_[i+1][j])/2);
          }
          newChartData.push(elem);
        }
        if (this.chartData_.length % 1) {
          newChartData.push(this.chartData_[this.chartData_.length-1]);
        }
        this.chartData_ = newChartData;
      }

      // Limit moving graph window to 15 seconds
      while ((this.chartData_[1][0] + 15000) < now)
        this.chartData_.splice(1,1);


      if (this.chart_) {
        this.updateChartOptions_();
        var data = google.visualization.arrayToDataTable(this.chartData_);
        this.chart_.draw(data, this.chartOptions_);
      }
    }
  };

  window.web_smoothness.FPSMeter = FPSMeter;
})();
