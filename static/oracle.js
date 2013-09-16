// Copyright 2013 Frederik Zipp.  All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

var oracle = (function() {

'use strict';

var modes = [
  {id: 'describe', name: 'Describe', desc: 'Describe the expression at the current point.'},
  {id: 'callees', name: 'Call targets', desc: 'Show possible callees of the function call at the current point.'},
  {id: 'callers', name: 'Callers', desc: 'Show the set of callers of the function containing the current point.'},
  {id: 'callgraph', name: 'Call graph', desc: 'Show the callgraph of the current program.'},
  {id: 'callstack', name: 'Call stack', desc: 'Show an arbitrary path from a root of the call graph to the function containing the current point.'},
  {id: 'freevars', name: 'Free variables', desc: 'Enumerate the free variables of the current selection.'},
  {id: 'implements', name: 'Implements', desc: 'Describe the \'implements\' relation for types in the package containing the current point.'},
  {id: 'peers', name: 'Channel peers', desc: 'Enumerate the set of possible corresponding sends/receives for this channel receive/send operation.'},
  {id: 'referrers', name: 'Referrers', desc: 'Enumerate all references to the object denoted by the selected identifier.'}
];

var message = {
  wait: 'Consulting the oracle ...',
  error: 'An error occurred.'
};

var title = 'Go source code oracle';

var currentFile;
var out, nums, code;

function init(source, output, file) {
  out = output;
  nums = source.find('.nums');
  code = source.find('.lines');
  currentFile = file;

  var menu = modeMenu();
  $('body').append(menu);
  hideOnEscape(menu, out);
  hideOnClickOff(menu);
  code.mouseup(function(e) {
    var sel = selectedRange();
    if (!isRangeWithinElement(sel, code)) {
      return;
    }
    menu.unbind('select').on('select', function(e, mode) {
      menu.hide();
      writeOutput(message.wait);
      // FIXME: these are character offsets, the oracle wants byte offsets
      query(mode, pos(currentFile, sel.startOffset, sel.endOffset), 'plain')
        .done(function(data) {
          writeOutput(data);
        })
        .fail(function(e) {
          writeOutput(message.error);
        });
    });
    menu.css({top: e.pageY, left: e.pageX});
    menu.show();
  });

  window.onpopstate = function(e) {
    var s = e.state;
    if (s) {
      loadAndShowSource(s.file, s.line);
    }
  }
}

var ESC = 27;

function hideOnEscape(menu, out) {
  $(document).keyup(function(e) {
    if (e.keyCode == ESC) {
      if (menu.is(':visible')) {
        menu.hide();
        return;
      }
      out.trigger('esc');
    }
  });
}

function hideOnClickOff(menu) {
  $('body').click(function(e) {
    if (!$(e.target).closest(code).length) {
      menu.hide();
    }
  });
}

function selectedRange() {
  return window.getSelection().getRangeAt(0);
}

function isRangeWithinElement(range, elem) {
  return range.commonAncestorContainer.parentElement == elem[0];
}

function query(mode, pos, format) {
  var data = {
    mode: mode,
    pos: pos,
    format: format
  };
  var get = (format == 'json') ? $.getJSON : $.get;
  return get('query', data);
}

function writeOutput(text) {
  appendLinkified(out.empty(), text).trigger('change');
}

// file:line.col-line.col:
var rangeAddress = /(.*):([0-9]+)\.([0-9]+)-([0-9]+)\.([0-9]+): (.*)/;
// file:line:col:
var singleAddress = /(.*):([0-9]+):([0-9]+): (.*)/;
// -:
var noAddress = /-: (.*)/;

function appendLinkified(element, text) {
  var match, arrow = '▶ ';
  var lines = text.split('\n');
  var n = lines.length;
  for (var i = 0; i < n; i++) {
    var line = lines[i];
    if (match = rangeAddress.exec(line)) {
      var file = match[1];
      var fromLine = match[2];
      var fromCol = match[3];
      var toLine = match[4];
      var toCol = match[5];
      var rest = match[6];
      var link = sourceLink(file, fromLine, arrow + rest, line);
      element.append(link).append('\n');
      continue;
    }
    if (match = singleAddress.exec(line)) {
      var file = match[1];
      var lineNo = match[2];
      var col = match[3];
      var rest = match[4];
      var link = sourceLink(file, lineNo, arrow + rest, line);
      element.append(link).append('\n');
      continue;
    }
    if (match = noAddress.exec(line)) {
      var rest = match[1];
      element.append('  ' + rest + '\n');
      continue;
    }
    element.append(line + '\n');
  }
  return element;
}

function sourceLink(file, line, text, tooltip) {
  var link = $('<a>').attr('title', tooltip).text(text);
  link.click(function() {
    pushHistoryState(file, line);
    loadAndShowSource(file, line);
  });
  return link;
}

function loadAndShowSource(file, line) {
  return loadRawSource(file)
    .done(function(src) {
      replaceSource(src);
      setCurrentFile(file);
      jumpTo(line);
    })
    .fail(function() {
      writeOutput(message.error);
    });
}

function pushHistoryState(file, line) {
  window.history.pushState({'file': file, 'line': line}, '',
    'source?' + $.param({'file': file}) + '#L' + line);
}

function loadRawSource(file) {
  return $.get('source?' + $.param({'file': file, 'format': 'raw'}));
}

function pos(file, start, end) {
  var p = file + ':#' + start;
  if (start != end) {
    p += ',#' + end;
  }
  return p;
}

function replaceSource(src) {
  code.text(src);
  showNumbers(countLines(src));
}

function showNumbers(n) {
  nums.empty();
  for (var i = 1; i <= n; i++) {
    nums.append($('<span>').attr('id', 'L'+i).text(i)).append('<br>');
  }
}

function setCurrentFile(path) {
  currentFile = path;
  $('h1').text('Source file ' + path);
  document.title = path + ' - ' + title;
}

function jumpTo(line) {
  $('#L'+line)[0].scrollIntoView(true);
}

function countLines(s) {
  return (s.match(/\n/g)||[]).length;
}

function modeMenu() {
  var m = $('<ul class="menu">').hide();
  $.each(modes, function(i, mode) {
    var item = $('<li>').text(mode.name).attr('title', mode.desc);
    item.click(function() {
      m.trigger('select', mode.id);
    });
    m.append(item);
  });
  return m;
}

return {
  init: init
};

})();