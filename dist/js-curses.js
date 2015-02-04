(function() {
"use strict()";

// functions, variables, etc. that should be exported, will be exported in the
// `exports` object (by default, the global namespace)
var exports = window;

// milliseconds between cursor blinks
var BLINK_DELAY = 500;

// default value for the character on 'empty' space
var EMPTY_CHAR = ' ';

/**
 * Named constants for colors: COLOR_WHITE, COLOR_RED, COLOR_GREEN, etc.
 **/
var colors = {
  WHITE: '#CCCCCC',
  RED: '#CC4444',
  GREEN: '#44CC44',
  YELLOW: '#CCCC44',
  BLUE: '#4444CC',
  MAGENTA: '#CC44CC',
  CYAN: '#44CCCC',
  BLACK: '#222222'
};

var construct_color_table = function() {
  for (var k in colors) {
    exports['COLOR_' + k] = colors[k];
  }
};
construct_color_table();

// default window: will be used as a default object for all curses functions,
// such as print(), addch(), move(), etc., if called directly instead of using
// win.print(), win.addch(), win.move(), etc.
var default_screen = null;

// curses window
// TODO: implement creating other windows, sub-wdinows (not just the global 
// 'stdscr' window)
var window_t = function() {
  // cursor position
  this.y = 0;
  this.x = 0;
  // width and height, in characters
  this.width = 0;
  this.height = 0;
  // parent window, if any
  this.parent = null;
};

// curses screen display; can contain subwindows
var screen_t = function() {
  window_t.call(this);
  // font used for rendering
  this.font = {
    name: 'monospace',
    size: 12,
    char_width: -1,
    char_height: -1
  };
  // default values for some input flags
  this._echo = false;   // do not print all keyboard input
  this._raw = false; // allow Ctl+<char> to be used for normal things, like
                        // copy/paste, select all, etc., and allow browser
                        // keyboard shortcuts
  this._blink = true;   // make the cursor blink
  this._blinkTimeout = 0;
  // 2-D array for tiles (see tile_t)
  this.tiles = [];
  // wrapper element
  this.container = null;
  // canvas and its rendering context
  this.canvas = null;
  this.context = null;
  // maps a character (and its attributes) to an already-drawn character
  // on a small canvas. this allows very fast rendering, but makes the
  // application use more memory to save all the characters
  this.char_cache = {};
  this.offscreen_canvases = [];
  this.offscreen_canvas_index = 0;
  // map of changes since last refresh: maps a [y,x] pair to a 'change' object
  // that describes what new 'value' a character should have
  this.changes = {};
  // event listeners
  this.listeners = {
    keydown: []
  };
  // character used for filling empty tiles
  // TODO: implement empty characters
  this.empty_char = EMPTY_CHAR;
  // current attributes (bold, italics, color, etc.) being used for text that
  // is being added
  this.current_attrs = A_NORMAL | COLOR_PAIR(0);
};

// tile on a window, used for keeping track of each character's state on the
// screen
var tile_t = function() {
  // true iff this tile has no content
  this.empty = true;
  // JQuery element associated to this tile
  this.element = null;
  // content character
  this.content = EMPTY_CHAR;
  // attributes (bold, italics, color, etc.)
  this.attrs = A_NORMAL | COLOR_PAIR(0);
};


// when called with a function, return that function, wrapped so that
// it can be used directly by being applied on `default_screen'.
//
// i.e., the call:
//   default_screen.addstr('hello world');
//
// can be shortened to:
//   addstr('hello world');
//
// if you define:
//   addstr = simplify(screen_t.prototype.addstr);
// when called with function name `function_name' that is defined in
// screen_t.prototype, will create a function with the same name in `exports'
// that calls this function using `default_screen'
var simplify = function(f) {
  return function() {
    return f.apply(default_screen, arguments);
  };
};

// similar to simplify, but convert the call so it can be done as in C with
// ncurses.
//
// for instance, the call:
//   win.addstr('hello world');
//
// can be rewritten:
//   waddstr(win, 'hello world');
//
// if you define:
//   waddstr = generalize(f);
var generalize = function(f) {
  return function() {
    return f.apply(arguments, [].slice.call(arguments, 1));
  };
};

// similar to simplify, but instead of allowing to call without supplying a
// `screen_t' object, allows calling by supplying a position for inserting
// text.
//
// for instance, the function call:
//   win.addstr(10, 10, 'hello world');
//
// will expand to:
//   win.move(10, 10);
//   win.addstr('hello world');
//
// if you define:
//   screen_t.prototype.addstr = shortcut_move(screen_t.prototype.addstr);
var shortcut_move = function(f) {
  return function(y, x) {
    var args = arguments;
    if (typeof y === "number" && typeof x === "number") {
      this.move(y, x);
      args = [].slice.call(arguments, 2);
    }
    return f.apply(this, args);
  };
};

// similar to simplify, but allows the caller to specify text attributes
// (as per attron() and attroff()) as the last argument to the call.
// 
// for instance, the function call:
//   win.addstr('hello world', A_BOLD | COLOR_PAIR(3));
//
// will expand to:
//   win.attron(A_BOLD | COLOR_PAIR(3));
//   win.addstr('hello world');
//   win.attroff(A_BOLD | COLOR_PAIR(3));
//
// if you define:
//   screen_t.prototype.addstr = attributify(screen_t.prototype.addstr);
var attributify = function(f) {
  return function() {
    var args = arguments;
    var attrs = null;
    if (arguments.length !== 0) {
      attrs = arguments[arguments.length - 1];
      if (typeof attrs === "number") {
        args = [].slice.call(arguments, 0, arguments.length - 1);
        this.attron(attrs);
      }
    }
    var return_value = f.apply(this, args);
    if (typeof attrs === "number") {
      this.attroff(attrs);
    }
    return return_value;
  };
};


/**
 * Some flags that can be used for attron(), attroff(), and attrset().
 **/
var A_NORMAL = exports.A_NORMAL = 0;
var A_STANDOUT = exports.A_STANDOUT = 0x10000; // TODO
var A_UNDERLINE = exports.A_UNDERLINE = A_STANDOUT << 1; // TODO
var A_REVERSE = exports.A_REVERSE = A_STANDOUT << 2;
var A_BLINK = exports.A_BLINK = A_STANDOUT << 3; // TODO
var A_DIM = exports.A_DIM = A_STANDOUT << 4; // TODO
var A_BOLD = exports.A_BOLD = A_STANDOUT << 5;

/**
 * Use this as a flag for attron(), attroff(), and attrset().
 *
 * Returns a bit mask that corresponds to the attribute for a given color pair.
 * Color pairs are defined as a (foreground,background) pair of colors using
 * the init_pair() function.
 *
 * Color pair 0 is always the default colors.
 *
 * @param {Integer} n The index of the color pair to use.
 * @return {Attrlist} Attribute that corresponds to color pair n.
 **/
var COLOR_PAIR = exports.COLOR_PAIR = function(n) {
  return n * 0x100;
};

// used for only getting the 'color pair' part of an attrlist
var COLOR_MASK = 0xFFFF;

// used for getting the number (n the 0 to COLOR_PAIRS range) of a color
// pair, from an attrlist
var pair_number = function(n) {
  return (n & COLOR_MASK) >> 8;
};

// table of color pairs used for the application
var color_pairs = {
  0: {
    fg: exports.COLOR_WHITE,
    bg: exports.COLOR_BLACK
  }
};

/**
 * Initialize a color pair so it can be used with COLOR_PAIR to describe a
 * given (foreground,background) pair of colours.
 *
 * Color pair 0 is always the default colors.
 *
 * Example:
 *     // define these colors for the rest of the program
 *     init_pair(1, COLOR_RED, COLOR_GREEN);
 *     init_pair(2, COLOR_GREEN, COLOR_RED);
 *     // red foreground, green background
 *     addstr(10, 10, "it's a christmas", COLOR_PAIR(1));
 *     // green foreground, red background
 *     addstr(11, 10, "miracle!", COLOR_PAIR(2));
 *
 * @param {Integer} pair_index Index for the pair to be created.
 * @param {String} foreground Foreground color to be used; must be supported by
 *   the canvas element.
 * @param {String} background Background color to be used; must be supported by
 *   the canvas element.
 **/
// initialize a color pair so it can be used with COLOR_PAIR(n) to describe
// a given (fg,bg) pair of colors.
var init_pair = exports.init_pair = function(pair_index,
                                            foreground, background) {
  color_pairs[pair_index] = {
    fg: foreground,
    bg: background
  };
};


/**
 * Set the new attrlist for the screen to the specified attrlist. Any previous
 * attributes are overwrittent completely.
 *
 * @param {Attrlist} attrs New attributes' values.
 **/
screen_t.prototype.attrset = function(attrs) {
  this.attrs = attrs;
};
exports.attrset = simplify(screen_t.prototype.attrset);

/**
 * Turn on an attribute (or multiple attributes, if you use a binary OR).
 *
 * Example:
 *     // add these attributes
 *     attron(A_BOLD | A_REVERSE | COLOR_PAIR(3));
 *     // in bold, with color pair 3, and foreground/background swapped
 *     addstr("hello world");
 *
 * @param {Attrlist} attrs Attributes to be added.
 **/
screen_t.prototype.attron = function(attrs) {
  var color_pair = attrs & COLOR_MASK;
  if (color_pair === 0) {
    color_pair = this.attrs & COLOR_MASK;
  }
  var other_attrs = ((attrs >> 16) << 16);
  other_attrs = other_attrs | ((this.attrs >> 16) << 16);
  var new_attrs = other_attrs | color_pair;
  this.attrset(new_attrs);
};
exports.attron = simplify(screen_t.prototype.attron);

/**
 * Turn off an attribute (or multiple attributes, if you use a binary OR).
 *
 * Example:
 *     // add these attributes
 *     attron(A_BOLD | COLOR_PAIR(1));
 *     addstr("i am bold, and red);
 *     // remove only the color attribute
 *     attroff(COLOR_PAIR(1));
 *     addstr("i am not red, but I am still bold");
 *     // remove the bold attribute
 *     attroff(A_BOLD);
 *     addstr("i am neither red, nor bold");
 *
 * @param {Attrlist} attrs Attributes to be removed.
 **/
screen_t.prototype.attroff = function(attrs) {
  var color_pair = this.attrs & COLOR_MASK;
  var new_attrs = ((attrs >> 16) << 16);
  new_attrs = ~new_attrs & this.attrs;
  if (attrs & COLOR_MASK) {
    new_attrs = new_attrs & ~COLOR_MASK;
  }
  this.attrset(new_attrs);
};
exports.attroff = simplify(screen_t.prototype.attroff);


/**
 * Name constants for keys. Useful for commonly-used keycodes, especially the
 * non-alphanumeric keys. All of their names start with `KEY_`. For instance,
 * there are `KEY_LEFT`, `KEY_UP`, `KEY_ESC`, `KEY_ENTER`, etc.
 *
 * There is also a constant for each letter of the alphabet (`KEY_A`, `KEY_B`,
 * etc.)
 **/
var keys = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  ESC: 27,
  TAB: 9,
  BACKSPACE: 8,
  HOME: 36,
  END: 35,
  ENTER: 13,
  PAGE_UP: 33,
  PAGE_DOWN: 34
};

var construct_key_table = function() {
  for (var k in keys) {
    exports['KEY_' + k] = keys[k];
  }
  for (k = 'A'.charCodeAt(0); k <= 'Z'.charCodeAt(0); k++) {
    var c = String.fromCharCode(k);
    exports['KEY_' + c] = k;
  }
};
construct_key_table();

// called by initscr() to add keyboard support
var handle_keyboard = function(win, container, require_focus) {
  // grab keyboard events for the whole page, or the container, depending
  // on the require_focus argument
  var keyboard_target = require_focus ? container : $('body');
  if (require_focus) {
    // apply tabindex="0" so this element can actually receive focus
    container.attr('tabindex', 0);
  }
  keyboard_target.keydown(function(event) {
    if (is_key_press(event)) {
      win.trigger('keydown', event.which, event, win);
    }
    // disable most browser shortcuts if the _raw flag is on for the window
    return ! win._raw;
  });
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


/**
 * Create a new screen, set is at the default screen, and return it.
 *
 * A screen uses an HTML Canvas element as its display in order to render
 * characters on-screen; it needs to have a specified, fixed, height and width,
 * and a specified, fixed, font and font size.
 *
 * The created screen is set as the "default screen". This allows calling
 * all js-curses in a C-style way, without explicitly specifying the screen
 * most method calls apply to, assuming initscr() is called only once for the
 * webpage. For isntance, the following are legal:
 *
 *     // creating the screen
 *     var screen = initscr('#container', 30, 30, 'Oxygen Mono', 14, true);
 *     // explicitly calling screen.move() and screen.addstr()
 *     screen.move(10, 10);
 *     screen.addstr("hello world");
 *     // implicitly calling screen.move() and screen.addstr()
 *     move(11, 10);
 *     screen.addstr("bonjour world");
 *     // updating the display
 *     refresh(); // or screen.refresh()
 *
 * The created screen is contained within the DOM element `container`; if
 * `container` is a string, it is used as a CSS selector with jQuery; if it
 * is undefined, a DOM element is created to hold the screen.
 *
 * The dimensions of the screen, in columns and rows (character-wise), are
 * specified by the `height` and `width` arguments.
 *
 * The font to use must be specified by the `font_name` and `font_size`
 * arguments. See load_font() for more information on font loading.
 *
 * If `require_focus` is true, the screen will only grab keyboard events when
 * it receives focus; additionally, it will make sure that it has a way to
 * grab the keyboard focus, by setting the HTML "tabindex" attribute for its
 * container. If `require_focus` is false or unspecified, then the screen
 * will grab all keyboard events on the webpage, which may get in the way
 * of the web browser's shortcuts, and a lot of other things.
 * 
 * @param {HTMLElement|String|undefined} container The container for the
 *    display canvas.
 * @param {Integer} height Height, in characters, of the screen.
 * @param {Integer} width Width, in chracters, of the screen.
 * @param {String} font_name Name of the font to be loaded.
 * @param {Integer} font_size Size, in pixels, of the font to be loaded.
 * @param {Boolean} [require_focus=false] Whether focus is required for keyboard
 *   events to be registered.
 * @return {screen_t} The created screen, and the new default screen.
 **/
var initscr = exports.initscr = function(container, height, width,
                                         font_name, font_size,
                                         require_focus) {
  if (typeof height !== "number") {
    throw new TypeError("height is not a number");
  }
  if (height < 0) {
    throw new RangeError("height is negative");
  }
  if (typeof width !== "number") {
    throw new TypeError("width is not a number");
  }
  if (width < 0) {
    throw new RangeError("width is negative");
  }
  // `container` can either be a DOM element, or an ID for a DOM element
  if (container !== undefined) {
    container = $(container);
  }
  else {
    container = $('<pre></pre>');
  }
  // clear the container
  container.html('');
  // create a new screen_t object
  var win = new screen_t();
  win.container = container;
  // set the height, in characters
  win.height = height;
  win.width = width;
  // create the canvas
  win.canvas = $('<canvas></canvas>');
  win.container.append(win.canvas);
  win.context = win.canvas[0].getContext('2d');
  // load the specified font
  load_font(win, font_name, font_size);
  // initialize the character tiles to default values
  var y, x;
  for (y = 0; y < height; y++) {
    win.tiles[y] = [];
    for (x = 0; x < width; x++) {
      win.tiles[y][x] = new tile_t();
    }
  }
  // set the created window as the default window for most operations
  // (so you can call functions like addstr(), getch(), etc. directly)
  default_screen = win;
  // draw a background
  win.clear();
  // add keyboard hooks
  handle_keyboard(win, container, require_focus);
  // make a blinking cursor
  // TODO: reimplement blinking
  // startBlink(win);
  // return the created window
  return win;
};

/**
 * Enable a blinking cursor.
 *
 * TODO
 **/
screen_t.prototype.blink = function() {
  if (! this._blink) {
    startBlink(this);
  }
  this._blink = true;
};
exports.blink = simplify(screen_t.prototype.blink);

/**
 * Disable a blinking cursor.
 *
 * TODO
 **/
screen_t.prototype.noblink = function() {
  if (this._blink) {
    this.tiles[this.y][this.x].element.addClass('a-reverse');
    clearTimeout(this._blinkTimeout);
    this._blinkTimeout = 0;
  }
  this._blink = false;
};
exports.noblink = simplify(screen_t.prototype.noblink);

/**
 * Quit js-curses.
 * 
 * TODO
 **/
screen_t.prototype.endwin = function() {
};
exports.endwin = simplify(screen_t.prototype.endwin);


// keys that are to be ignored for the purposes of events
// TODO
var ignoreKeys = {
  Control: true,
  Shift: true,
  Alt: true,
  AltGraph: true,
  Unidentified: true
};

// return true iff the KeyboardEvent `event' is an actual keypress of a
// printable character, not just a modifier key (like Ctrl, Shift, or Alt)
var is_key_press = function(event) {
  // TODO
  return ! ignoreKeys[event.key];
};

// used for making a blinking cursor
// TODO: rewrite for canvas
var startBlink = function(win) {
  var do_blink = function() {
    win.tiles[win.y][win.x].element.addClass('a-reverse');
    win._blinkTimeout = setTimeout(do_unblink, BLINK_DELAY);
  };
  var do_unblink = function() {
    win.tiles[win.y][win.x].element.removeClass('a-reverse');
    win._blinkTimeout = setTimeout(do_blink, BLINK_DELAY);
  };
  win._blinkTimeout = setTimeout(do_blink, BLINK_DELAY);
};

/**
 * Move the cursor to a given position on the screen. If the position is outside
 * of the screen's bound, a RangeError is thrown.
 *
 * All output from addch() and addstr() is done at the position of the cursor.
 *
 * @param {Integer} y y position of the new position.
 * @param {Integer} x x position of the new position.
 * @throws RangeError
 **/
screen_t.prototype.move = function(y, x) {
  if (y < 0 || y >= this.height || x < 0 || x >= this.width) {
    throw new RangeError("coordinates out of range");
  }
  // var tile = this.tiles[this.y][this.x];
  // TODO: handle blinking/unblinking on move
  this.y = y;
  this.x = x;
};
exports.move = simplify(screen_t.prototype.move);


// number of chars saved per off-screen canvas
var CHARS_PER_CANVAS = 256;

/**
 * Load a font with given attributes `font_name` and `font_size`. You should
 * ensure that the font has already been loaded by the browser before calling
 * `load_font`. The bold variant of the font should already have been loaded,
 * if you intend to use it. The usual way to do this is to insert an element
 * that uses that font in your webpage's HTML. This function is automatically
 * called by `initscr`.
 *
 * Print warning messages to the web console when the font does not appear to
 * be a monospace font.
 *
 * @param {String} font_name Name of the font to be loaded.
 * @param {Integer} font_size Size of the font to be loaded.
 **/
// load a font with given attributes font_name and font_size
var load_font = function(win, font_name, font_size) {
  win.context.font = 'Bold ' + font_size + 'px ' + font_name;
  win.context.textAlign = 'left';
  var c = 'm';
  // calculate the probable font metrics
  var metrics = win.context.measureText(c);
  var height = font_size + 2;
  var width = Math.round(metrics.width);
  // check that it's (probably) a monospace font
  var testChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" + 
    "_-+*@ ()[]{}/\\|~`,.0123456789";
  var i;
  for (i = 0; i < testChars.length; i++) {
    c = testChars[i];
    metrics = win.context.measureText(c);
    if (Math.round(metrics.width) !== width) {
      console.warn(font_name + ' does not seem to be a monospace font');
    }
  }
  // resize the canvas
  win.canvas.attr({
    height: Math.round(win.height * height),
    width: Math.round(win.width * width)
  });
  // save the currently used font
  win.font.name = font_name;
  win.font.size = font_size;
  win.font.char_height = height;
  win.font.char_width = width;
  // create an offscreen canvas for rendering
  var offscreen = make_offscreen_canvas(win.font);
  win.offscreen_canvases = [offscreen];
};
exports.loadfont = simplify(screen_t.prototype.loadfont);

/**
 * Clear the whole window immediately, without waiting for the next refresh. Use
 * this sparingly, as this can cause very bad performance if used too many
 * times per second.
 **/
screen_t.prototype.clear = function() {
  // window height and width
  var height = this.height * this.font.char_height;
  var width = this.width * this.font.char_width;
  // clear the window
  this.context.fillStyle = color_pairs[0].bg;
  this.context.fillRect(0, 0, width, height);
  // reset all the character tiles
  var y, x;
  for (y = 0; y < this.height; y++) {
    for (x = 0; x < this.width; x++) {
      var tile = this.tiles[y][x];
      tile.content = this.empty_char;
      tile.empty = true;
      tile.attrs = A_NORMAL;
    }
  }
};
exports.clear = simplify(screen_t.prototype.clear);

/**
 * Push the changes made to the buffer, such as those made with addstr() and
 * addch(). The canvas is updated to reflect the new state of the window. Uses
 * differential display to optimally update only the parts of the screen that
 * have actually changed.
 *
 * Note that functions like addstr() and addch() will not do anything until
 * refresh() is called.
 **/
screen_t.prototype.refresh = function() {
  // for each changed character
  var k;
  for (k in this.changes) {
    var change = this.changes[k];
    var attrs = change.attrs;
    var c = change.value;
    var char_cache = this.char_cache;
    draw_char(this, change.at.y, change.at.x, c, char_cache, attrs);
  }
  this.changes = {};
};
exports.refresh = simplify(screen_t.prototype.refresh);

/**
 * Output a single character to the console, at the current position, as
 * specified by `move` (or move to the given position, and then output the
 * given character).
 *
 * The cursor is moved one position to the right. If the end of the line is
 * reached, the cursor moves to the next line and returns to column 0.
 *
 * All current attributes (see attron(), attroff(), and attrset()) are applied
 * to the output. You may also supply a temporary attrlist as a last argument
 * to this function.
 *
 * Note that the visual display (the canvas) is not updated until the
 * refresh() function is called.
 *
 * TODO: implement tab and newline characters
 *
 * @param {Integer} [y] y position for output.
 * @param {Integer} [x] x position for output.
 * @param {Character} c Character to be drawn.
 * @param {Attrlist} [attrs] Temporary attributes to be applied.
 **/
screen_t.prototype.addch = function(c) {
  if (typeof c !== "string") {
    throw new TypeError("c is not a string");
  }
  if (c.length !== 1) {
    throw new RangeError("c is not a character");
  }
  if (this.x >= this.width || this.x < 0) {
    throw new RangeError("invalid coordinates");
  }
  // treat all whitespace as a single space character
  if (c === '\t' || c === '\n' || c === '\r') {
    c = this.empty_char;
  }
  var tile = this.tiles[this.y][this.x];
  // only do this if the content (or attrlist) changed
  if (c !== tile.content || this.attrs !== tile.attrs) {
    // update the tile
    tile.content = c;
    tile.empty = false;
    tile.attrs = this.attrs;
    // pixel-pos for drawing
    var draw_x = Math.round(this.font.char_width * this.x);
    var draw_y = Math.round(this.font.char_height * this.y);
    // add an instruction to the 'changes queue'
    this.changes[this.y + ','  + this.x] = {
      at: {
        x: draw_x,
        y: draw_y
      },
      value: c,
      attrs: this.attrs
    };
  }
  // move to the right
  if (this.x < this.width - 1) {
    this.move(this.y, this.x + 1);
  }
  else if (this.y < this.height - 1) {
    // or continue to next line if the end of the line was reached
    this.move(this.y + 1, 0);
  }
}; 
// allow calling as addch(y, x, c);
screen_t.prototype.addch = shortcut_move(screen_t.prototype.addch);
screen_t.prototype.addch = attributify(screen_t.prototype.addch);
exports.addch = simplify(screen_t.prototype.addch);

/**
 * Output a string to the console, at the current position, as specified by
 * `move` (or move to the given position, and then output the
 * given character).
 *
 * The cursor is moved to the end of the text. If the end of the line is
 * reached, the cursor moves to the next line, the cursor returns to column 0,
 * and text output continues on the next line.
 *
 * All current attributes (see attron(), attroff(), and attrset()) are applied
 * to the output. You may also supply a temporary attrlist as a last argument
 * to this function.
 *
 * Note that the visual display (the canvas) is not updated until the
 * refresh() function is called.
 *
 * TODO: implement tab and newline characters
 *
 * @param {Integer} [y] y position for output.
 * @param {Integer} [x] x position for output.
 * @param {Character} str Character to be drawn.
 * @param {Attrlist} [attrs] Temporary attributes to be applied.
 **/
screen_t.prototype.addstr = function(str) {
  var i;
  for (i = 0; i < str.length && this.x < this.width; i++) {
    this.addch(str[i]);
  }
  if (i !== str.length) {
    throw new RangeError("not enough room to add the whole string");
  }
}; 
// allow calling as addstr(y, x, str);
screen_t.prototype.addstr = shortcut_move(screen_t.prototype.addstr);
screen_t.prototype.addstr = attributify(screen_t.prototype.addstr);
exports.addstr = simplify(screen_t.prototype.addstr);

// used for creating an off-screen canvas for pre-rendering characters
var make_offscreen_canvas = function(font) {
  var canvas = $('<canvas></canvas>');
  canvas.attr({
    height: font.char_height,
    width: CHARS_PER_CANVAS * font.char_width
  });
  canvas.ctx = canvas[0].getContext('2d');
  return canvas;
};

// draw a character at pixel-pos (x,y) on window `win`
//
// the character drawn is `c`, with attrlist `attrs`, and may be pulled
// from the canvas cache ̀`char_cache`
//
// draw_char() is used by refresh() to redraw characters where necessary
var draw_char = function(win, y, x, c, char_cache, attrs) {
  var offscreen = find_offscreen_char(win, c, char_cache, attrs);
  // apply the drawing onto the visible canvas
  win.context.drawImage(offscreen.canvas,
                        offscreen.sx, offscreen.sy,
                        win.font.char_width, win.font.char_height,
                        x, y,
                        win.font.char_width, win.font.char_height);
};

// used by draw_char for finding (or creating) a canvas where the character
// `c` is drawn with attrlist `attrs`
//
// the return value is an object of the format:
// {
//   canvas: (canvas element),
//   sy: (Y position of the character on the canvas element),
//   sx: (X position of the character on the canvas element)
// }
var find_offscreen_char = function(win, c, char_cache, attrs) {
  // number for the color pair for the character
  var color_pair = pair_number(attrs);
  // foreground and background colors
  var bg = color_pairs[color_pair].bg;
  var fg = color_pairs[color_pair].fg;
  // source y, source x, and source canvas for drawing
  var sy = 0;
  var sx;
  var canvas;
  // if the char is already drawn on one of the offscreen canvases, with the
  // right attributes
  if (char_cache[c] && char_cache[c][attrs]) {
    // graphics saved, just use the cache
    canvas = char_cache[c][attrs].canvas;
    sx = char_cache[c][attrs].sx;
  }
  else {
    // if canvas is full, use another canvas
    if (win.offscreen_canvas_index >= CHARS_PER_CANVAS - 1) {
      win.offscreen_canvas_index = 0;
      canvas = make_offscreen_canvas(win.font);
      win.offscreen_canvases.push(canvas);
    }
    canvas = win.offscreen_canvases[win.offscreen_canvases.length - 1];
    var ctx = canvas.ctx;
    sx = Math.round(win.offscreen_canvas_index * win.font.char_width);
    // populate the `char_cache` with wher to find this character
    if (! char_cache[c]) {
      char_cache[c] = {};
    }
    win.char_cache[c][attrs] = {
      canvas: canvas,
      sx: sx
    };
    // draw a background
    ctx.fillStyle = (attrs & A_REVERSE) ? fg : bg;
    ctx.fillRect(sx, 0, win.font.char_width, win.font.char_height);
    // choose a font
    var font = (attrs & A_BOLD) ? 'Bold ' : '';
    font += win.font.size + 'px ' + win.font.name;
    ctx.font = font;
    ctx.textBaseline = 'hanging';
    // draw the character
    ctx.fillStyle = (attrs & A_REVERSE) ? bg : fg;
    ctx.fillText(c, sx, 1);
    win.offscreen_canvas_index++;
  }
  // return an object describing the location of the character
  return {
    canvas: canvas[0],
    sx: sx,
    sy: sy
  };
};



/**
 * Trigger an event on the window, with name `event_name`.
 *
 * Call all the event handlers bound to that event, and pass any other arguments
 * given to trigger() to each even handler.
 *
 * @param {String} event_name Name of the event to be fired.
 **/
screen_t.prototype.trigger = function(event_name) {
  if (this.listeners[event_name]) {
    var args = [].slice.call(arguments, 1);
    var i;
    for (i = 0; i < this.listeners[event_name].length; i++) {
      this.listeners[event_name][i].apply(this, args);
    }
  }
};

/**
 * Add an event handler for the event with name `event_name`.
 *
 * @param {String} event_name Name of the event to listen to.
 * @param {Function} callback Function that will be called when the event is
 *   fired.
 **/
screen_t.prototype.on = function(event_name, callback) {
  if (! this.listeners[event_name]) {
    this.listeners[event_name] = [];
  }
  this.listeners[event_name].push(callback);
};

/**
 * Remove an event handler for the event with name `event_name`. This removes
 * an event handler that was previously added with on().
 *
 * @param {String} event_name Name of the event the handler was bound to.
 * @param {Function} callback Function that was passed to on() previously.
 **/
screen_t.prototype.off = function(event_name, callback) {
  if (! this.listeners[event_name]) {
    this.listeners[event_name] = [];
  }
  var i;
  for (i = 0; i < this.listeners[event_name].length; i++) {
    if (this.listeners[event_name][i] == callback) {
      break;
    }
  }
  if (i !== this.listeners[event_name].length) {
    this.listeners[event_name].splice(i, 1);
  }
};

/**
 * Add an event handler for the event with name `event_name`. The event handler
 * is removed after executing once.
 *
 * @param {String} event_name Name of the event to listen to.
 * @param {Function} callback Function that will be called when the event is
 *   fired.
 **/
screen_t.prototype.one = function(event_name, callback) {
  var win = this;
  var f = function() {
    callback.apply(this, arguments);
    win.off(event_name, f);
  };
  this.on(event_name, f);
};

/**
 * Call function `callback` only once, when a key is entered by the user (if
 * the screen has focus). `callback` will receive an event object as its first
 * argument.
 *
 * The description of the event object is still subject to change.
 *
 * @param {Function} callback Function to be called when a key is pressed.
 **/
screen_t.prototype.getch = function(callback) {
  this.one('keydown', callback);
};
exports.getch = simplify(screen_t.prototype.getch);

/**
 * Call function `callback` when a key is entered by the user (if the screen
 * has focus). `callback` will receive an event object as its first argument.
 *
 * The description of the event object is still subject to change.
 *
 * @param {Function} callback Function to be called when a key is pressed.
 **/
screen_t.prototype.ongetch = function(callback) {
  this.on('keydown', callback);
};
exports.ongetch = simplify(screen_t.prototype.ongetch);

/**
 * Stop listening to keyboard events; undoes a previous call to getch() or
 * ongetch(). The `callback` argument must be the same as in a previous call to
 * getch() or ongetch().
 *
 * @param {Function} callback Function that should not be called anymore when a
 *   key is pressed.
 **/
screen_t.prototype.ungetch = function(callback) {
  this.off('keydown', callback);
};
exports.ungetch = simplify(screen_t.prototype.ungetch);

})();