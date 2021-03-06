/**
 * Name constants for keys. Useful for commonly-used keycodes, especially the
 * non-alphanumeric keys. All of their names start with `KEY_`. For instance,
 * there are `KEY_LEFT`, `KEY_UP`, `KEY_ESC`, `KEY_ENTER`, etc.
 *
 * There is also a constant for each letter of the alphabet (`KEY_A`, `KEY_B`,
 * etc.)
 **/
exports.KEY_LEFT = 37;
exports.KEY_UP = 38;
exports.KEY_RIGHT = 39;
exports.KEY_DOWN = 40;
exports.KEY_ESC = 27;
exports.KEY_TAB = 9;
exports.KEY_BACKSPACE = 8;
exports.KEY_HOME = 36;
exports.KEY_END = 35;
exports.KEY_ENTER = 13;
exports.KEY_PAGE_UP = 33;
exports.KEY_PAGE_DOWN = 34;

// helper function for adding KEY_A, KEY_B, KEY_C, etc. to `exports`.
var construct_key_table = function() {
  for (k = 'A'.charCodeAt(0); k <= 'Z'.charCodeAt(0); k++) {
    var c = String.fromCharCode(k);
    exports['KEY_' + c] = k;
  }
};
construct_key_table();

var KEY_RESIZE = exports.KEY_RESIZE = '$RESIZE';

// called by initscr() to add keyboard support
var handle_keyboard = function(scr, container, require_focus) {
  // grab keyboard events for the whole page, or the container, depending
  // on the require_focus argument
  var keyboard_target = require_focus ? container : $('body');
  if (require_focus) {
    // apply tabindex="0" so this element can actually receive focus
    container.attr('tabindex', 0);
  }
  keyboard_target.keydown(function(event) {
    // true iff the event key event should not be sent to the browser
    var cancel = scr._raw;
    if (is_key_press(event)) {
      // trigger the event, and call event handlers as
      // handler(keycode, event, screen);
      var returned = scr.trigger('keydown', event.which, event, scr);
      if (typeof returned === "boolean") {
	cancel = ! returned;
      }
    }
    // disable most browser shortcuts if the _raw flag is on for the window, and
    // the handlers did not return true
    return ! cancel;
  });
  if (scr.auto_height || scr.auto_width) {
    $(window).resize(function(event) {
      // calculate the new width/height of the screen, in characters
      var height = scr.height;
      var width = scr.width;
      if (scr.auto_height) {
	height = Math.floor(container.height() / scr.font.char_height);
	if (scr.min_height) {
	  height = Math.max(height, scr.min_height);
	}
      }
      if (scr.auto_width) {
	width = Math.floor(container.width() / scr.font.char_width);
	if (scr.min_width) {
	  width = Math.max(width, scr.min_width);
	}
      }
      if (height === scr.height && width === scr.width) {
	// exit if unchanged
	return;
      }
      // resize the canvas
      resize_canvas(scr, height, width);
      // change the 'official' width/height of the window
      scr.height = height;
      scr.width = width;
      // force redrawing of the whole window
      // scr.full_refresh();
      // fire an event for getch() and the like, with KEY_RESIZE as the keycode
      scr.trigger('keydown', KEY_RESIZE);
    });
  }
};

// helper function for resizing a canvas while trying to keep its current state
var resize_canvas = function(scr, height, width) {
  // create a new canvas to replace the current one (with the new size)
  // this is because resizing a canvas also clears it
  var h = height * scr.font.char_height;
  var w = width * scr.font.char_width;
  var new_canvas = $('<canvas></canvas>');
  new_canvas.attr({
    height: h,
    width: w
  });
  var ctx = new_canvas[0].getContext('2d');
  var prev_h = scr.height * scr.font.char_height;
  var prev_w = scr.width * scr.font.char_width;
  h = Math.min(prev_h, h);
  w = Math.min(prev_w, w);
  // copy the old canvas onto the new one
  ctx.drawImage(scr.canvas[0],
		0, 0, w, h,
		0, 0, w, h);
  // replace the old canvas with the new one
  scr.canvas.replaceWith(new_canvas);
  scr.canvas = new_canvas;
  scr.context = ctx;
  // add the necessary tiles to the tile-grid
  var y, x;
  for (y = 0; y < scr.height; y++) {
    for (x = scr.width; x < width; x++) {
      scr.tiles[y][x] = new tile_t();
      scr.tiles[y][x].content = ' ';
      scr.display[y][x] = new tile_t();
      scr.display[y][x].content = '';
    }
  }
  for (y = scr.height; y < height; y++) {
    scr.tiles[y] = [];
    scr.display[y] = [];
    for (x = 0; x < width; x++) {
      scr.tiles[y][x] = new tile_t();
      scr.tiles[y][x].content = ' ';
      scr.display[y][x] = new tile_t();
      scr.display[y][x].content = '';
    }
  }
};

/**
 * Disable most browser shortcuts, allowing your application to use things like
 * Ctrl+C and Ctrl+T as keybindings within the application. 
 *
 * You may want to use the `require_focus` option in initscr() if you use this
 * function.
 **/
screen_t.prototype.raw = function() {
  this._raw = true;
};
exports.raw = simplify(screen_t.prototype.raw);

/**
 * Enables most browser shortcuts; undoes a previous call to raw(). This is
 * the default behaviour.
 **/
screen_t.prototype.noraw = function() {
  this._raw = false;
};
exports.noraw = simplify(screen_t.prototype.nowraw);

/**
 * All characters typed by the user are printed at the cursor's position.
 *
 * TODO
 **/
var echo = exports.echo = function() {
  this._echo = true;
};

/**
 * All characters not typed by the user are printed at the cursor's position.
 * Undoes a previous call to echo(). This is the default behaviour.
 **/
var noecho = exports.noecho = function() {
  this._echo = false;
};

/**
 * Enables non-printable characters to also be grabbed as keyboard events
 * (especially arrow keys, among others).
 *
 * TODO
 **/
var keypad = exports.keypad = function() {};
