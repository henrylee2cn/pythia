// Copyright 2013 Frederik Zipp.  All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package main

import (
	"bytes"
	"encoding/json"
	"go/build"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/fzipp/pythia/internal/static"
	"github.com/fzipp/pythia/internal/tools/go/loader"
	"github.com/fzipp/pythia/internal/tools/godoc"
	"github.com/fzipp/pythia/internal/tools/oracle"
)

var (
	indexView  = parseTemplate("index.html")
	sourceView = parseTemplate("source.html")
)

// serveIndex delivers the scope index page, which is the first
// page presented to the user.
func serveIndex(w http.ResponseWriter, req *http.Request) {
	err := indexView.Execute(w, struct {
		Scope    string
		Packages []*loader.PackageInfo
	}{
		Scope:    strings.Join(args, " "),
		Packages: packages,
	})
	if err != nil {
		log.Println(err)
	}
}

// serveSource delivers the source view page, which is the main
// workspace of the tool, where the user creates the queries to
// the oracle and browses their results.
//
// The request parameter 'file' determines the source file to be
// shown initially, e.g. "/path/to/file.go". The contents of the
// file are not loaded in this request, but in a subsequent
// asynchronous request handled by serveFile.
//
// Returns a "403 Forbidden" status code if the requested file
// is not within the import scope.
func serveSource(w http.ResponseWriter, req *http.Request) {
	file := req.FormValue("file")
	if isForbidden(file) {
		errorForbidden(w)
		return
	}
	err := sourceView.Execute(w, file)
	if err != nil {
		log.Println(err)
	}
}

// serveFile delivers an HTML fragment of a Go source file with
// highlighted comments and an (optional) highlighted selection.
// The request parameters are:
//
//   path: "/path/to/file.go"
//   s: optional selection range like "line.col-line.col", e.g. "24.4-25.10"
//
// Returns a "403 Forbidden" status code if the requested file
// is not within the import scope, or a "404 Not Found" if the
// file can't be read.
func serveFile(w http.ResponseWriter, req *http.Request) {
	path := req.FormValue("path")
	if isForbidden(path) {
		errorForbidden(w)
		return
	}
	content, err := ioutil.ReadFile(path)
	if err != nil {
		log.Println(req.RemoteAddr, err)
		http.NotFound(w, req)
		return
	}

	var sel godoc.Selection
	s, err := parseSelection(req.FormValue("s"))
	if err == nil {
		offsets := s.byteOffsetsIn(content)
		sel = godoc.RangeSelection(offsets)
	}

	var buf bytes.Buffer
	godoc.FormatText(&buf, content, -1, true, "", sel)

	buf.WriteTo(w)
}

// isForbidden checks if the given file path is in the file set of the
// imported scope and returns true if not, otherwise false.
func isForbidden(path string) bool {
	// files must be sorted!
	i := sort.SearchStrings(files, path)
	return i >= len(files) || files[i] != path
}

func errorForbidden(w http.ResponseWriter) {
	http.Error(w, "Forbidden", 403)
}

// serveQuery executes a query to the oracle and delivers the results
// in the specified format. The request parameters are:
//
//   mode: e.g. "describe", "callers", "freevars", ...
//   pos: file name with byte offset(s), e.g. "/path/to/file.go:#1457,#1462"
//   format: "json" or "plain", no "xml" at the moment
//
// If the application was launched in verbose mode, each query will be
// logged like an invocation of the oracle command.
func serveQuery(w http.ResponseWriter, req *http.Request) {
	mode := req.FormValue("mode")
	pos := req.FormValue("pos")
	format := req.FormValue("format")
	if *verbose {
		log.Println(req.RemoteAddr, cmdLine(mode, pos, format, args))
	}
	res, err := queryOracle(mode, pos)
	if err != nil {
		io.WriteString(w, err.Error())
		return
	}
	writeResult(w, res, format)
}

func queryOracle(mode, pos string) (*oracle.Result, error) {
	mutex.Lock()
	defer mutex.Unlock()
	if mode == "what" {
		return oracle.Query(args, mode, pos, nil, &build.Default, false)
	}
	qpos, err := oracle.ParseQueryPos(prog, pos, false)
	if err != nil {
		return nil, err
	}
	return ora.Query(mode, qpos)
}

// writeResult writes the result of an oracle query to w in the specified
// format, "json" or "plain".
func writeResult(w io.Writer, res *oracle.Result, format string) {
	if format == "json" {
		b, err := json.Marshal(res.Serial())
		if err != nil {
			io.WriteString(w, err.Error())
			return
		}
		w.Write(b)
		return
	}
	res.WriteTo(w)
}

// serveStatic delivers the contents of a file from the static file map.
func serveStatic(w http.ResponseWriter, req *http.Request) {
	name := req.URL.Path
	data, ok := static.Files[name]
	if !ok {
		http.NotFound(w, req)
		return
	}
	http.ServeContent(w, req, name, time.Time{}, strings.NewReader(data))
}
