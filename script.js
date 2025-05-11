
    /* A.Gonzalez. SJ AMDG */

    CHAR_LYRICS = "*"
    CHAR_CHORDS = "@"
    
    LONG_WORD = 4
    
    
    CHAR_SHARP = "#";
    CHAR_FLAT = "b";
    OCTAVE = 12;
    
    var notes_ame = {"c":0, "d":2, "e":4, "f":5, "g":7, "a":9, "b":11};
    var notes_spa = {"do":0, "re":2, "mi":4, "fa":5, "sol":7, "la":9, "si":11};
    
    var SHARP_SCALE_AME = ["c", "c#","d", "d#", "e", "f", "f#", 
                "g", "g#", "a", "a#", "b"];
    var SHARP_SCALE_SPA = ["do", "do#","re", "re#", "mi", "fa", "fa#", 
                   "sol", "sol#", "la", "la#", "si"];
    
    var FLAT_SCALE_SPA = ["do", "reb","re", "mib", "mi", "fa", "solb", 
                "sol", "lab", "la", "sib", "si"];
    var FLAT_SCALE_AME = ["c", "cb","d", "db", "e", "f", "fb", 
                  "g", "gb", "a", "ab", "a"];
    
    
    var FLAT_SCALE = FLAT_SCALE_SPA;
    var SHARP_SCALE = SHARP_SCALE_SPA;
    var notes = notes_spa;
    
    function setCipherSpa() {
        FLAT_SCALE = FLAT_SCALE_SPA;
        SHARP_SCALE = SHARP_SCALE_SPA;
        notes = notes_spa;
    }
    
    function setCipherAme() {
        FLAT_SCALE = FLAT_SCALE_AME;
        SHARP_SCALE = SHARP_SCALE_AME;
        notes = notes_ame;
    }
    
    function genSpaces(num)
    {
        if(num <= 0) return "";
        return Array(num + 1).join(" ");
    }
    
    function addChord(rest, chord,shift)
    {
        //var line = rest;
        if((rest.length < chord.position) || (rest.length == 0 && chord.position == 0)) {
            var spaces = genSpaces(chord.position - rest.length);
            return rest + spaces + chord.transposeChord(shift);
        } else {
            return rest + "-" + chord.transposeChord(shift);
        }
    }
    
    
    
    function chord(cSpec) {
        this.tone = 0;
        this.chordText = cSpec;
        this.position = -1;
        this.modifiers = "";
     
        this.splitSpec = function(spec) {
            var parts = {tone: 0, strTone: "", rest: ""};
            for (var key in notes) {
                if (notes.hasOwnProperty(key)) {
                    var len = key.length;
                    if(spec.slice(0, len).toLowerCase() == key) {
                        parts.strTone = spec.slice(0,len);
                        parts.tone = notes[key];
                        parts.rest = spec.slice(len);
                        return parts;
                    }
                }
            }
            return null; /* TODO: ? */
            
        }
    
        
        this.detectNote = function (spec) {
            var temp = this.splitSpec(cSpec);
            if(temp == null) {
                this.tone = null;
                return;
            }
            this.tone = temp.tone;
            this.strTone = temp.strTone;
    
            if(temp.rest.slice(0,1) == CHAR_SHARP) {
                this.tone += 1;
                this.shift = temp.rest.slice(0,1);
                temp.rest = temp.rest.slice(1);
            } else if(temp.rest.slice(0,1) == CHAR_FLAT) {
                this.tone -= 1;
                this.shift = temp.rest.slice(0,1);
                temp.rest = temp.rest.slice(1);
            }
            this.modifiers = temp.rest;
            if(this.tone < 0) this.tone += OCTAVE;
                    
        };
    
        this.transposeChord = function(shift) {
            if(shift == 0 || this.tone == null) return this.chordText;
                // TODO: case sensitive
                var tone = (this.tone + shift) % OCTAVE;
            if(this.shift == CHAR_FLAT) {
                return this.maskCase(FLAT_SCALE[tone],this.strTone) + this.modifiers;
            } else {
                return this.maskCase(SHARP_SCALE[tone],this.strTone) + this.modifiers;
            }
        };
        this.maskCase = function (strChord, mask) {
            if(mask.length == 0) {
                return strChord;
            } else if(mask.length == 1) {
                if(mask == mask.toLowerCase()) {
                    return strChord.toLowerCase();
                } 
                return strChord.toUpperCase();
            } 
    
            var firstLetter = strChord.slice(0, 1);
            var rest = strChord.slice(1);
            var mask1 = mask.slice(0,1);
            var mask2 = mask.slice(1,2);
            if(mask1 == mask1.toLowerCase()) {
                firstLetter = firstLetter.toLowerCase();
            } else {
                firstLetter = firstLetter.toUpperCase();
            }
            if(mask2 == mask2.toLowerCase()) {
                rest = rest.toLowerCase();
            } else {
                rest = rest.toUpperCase();
            }
            if(rest.slice(-1).toLowerCase() == CHAR_FLAT) {
                rest = rest.slice(0,-1) + CHAR_FLAT;
            }
            return firstLetter + rest;	 
    
        }
        this.detectNote(cSpec);
    }
    
    
    function getFormText() {
        var x = document.getElementById("frm1");
        var i;
        for (i = 0; i < x.length ;i++) {
        if(x.elements[i].name == "mydata") {
            return x.elements[i].value;
        }
        }
        return "";
    }
    
    function getCipherSelection() {
        var radios = document.getElementsByName("cipher");
        var i;
        for (i = 0; i < radios.length ;i++) {
        if(radios[i].checked) {
            return radios[i].value;
        }
        }
        return "";
    }
    
    
    
    /* --------------------------------------------------------------- */
    
    
    function lineAnalisys(line) {
        stats = {"words":0, "chords": 0, "long": 0, "chord-line": false};
         
        // TODO: sanitize line
        // TODO: manage isolated "+7", etc
        
        //var outText = ""; // debug...
        var tokens = line.split(/\s+/);
        //outText = outText + " " + tokens.length + " tokens: ";
        var countChord = 0;
        var countNormal = 0;
        var countLong = 0;
        //TODO: count long words (e.g. more than 4 letters)
        for (var i = 0; i < tokens.length; i++) {
            //try to parse token as a chord
            
            if(tokens[i].length > 0) {
                ch = new chord(tokens[i]);
                //outText = outText + "|"+ch.chordText;
            
                if(ch.tone == null) {
                    countNormal += 1;
                    if(tokens[i].length > LONG_WORD) {
                        countLong += 1;
                    }
                } else{
                    countChord += 1;
                }
            }
            
        }
        //outText = outText + "| chords:"+countChord + " normal:" + countNormal;
        
        //TODO: may be more complex
        var eval = false;
        if(countChord == 0 || countLong > 0) eval = false;
        else {
            eval = (countChord > countNormal);
        }
    
        stats['words'] = countNormal;
        stats['chors'] = countChord;
        stats['long'] = countLong;
        stats['chord-line'] = eval;
    
        return stats;
        
    }
    
    /**
     * Return true if the line is a line of chords, 
     */
    function detectChordLine(line) {
        stats = lineAnalisys(line);
        return stats['chord-line'];
    }
    
    
    function iterateChordLine(line, offset)
    {
        //var chord = {note : ""; modifiers = ""}
        var pair = {rest : line, mChord : null}
    
        var i = line.search(/\S/); //search non-whitespace
        if(i == -1) {
            return pair;
        }
        var rest = line.substr(i);
        var j = rest.search(/\s/); //search whitespace
        if(j == -1) {
            j = rest.length;
        }
        var chordSpec = line.slice(i,j+i);
        pair.mChord = new chord(chordSpec);
        pair.mChord.position = i;
        //pair.mChord.text = chordSpec;
        //pair.mChord = chordSpec;
        pair.rest = line.slice(0,i) + genSpaces(j) + line.substr(j+i);
        return pair; // HTML
    }
    
    
    function processChordLine(line, shift)
    {
        var chords = [];
        var pair = iterateChordLine(line);
        var count = 0;
    
        while(pair.mChord != null) {
            chords.push(pair.mChord);
            pair = iterateChordLine(pair.rest);
            count += 1;
        }
        
        var chdLine = "";
        for(var c in chords) {
            chdLine = addChord(chdLine, chords[c],shift);
            //chdLine = chdLine + "-" + chords[c].text;
        }
        var res = {chords : chdLine, text : pair.rest};
        return res; // HTML
    }
    
    function testChordLine() {
        //var text = getFormText();
        var shift = 2;
        var text = "     RE7";
        var outText = "<pre>";
        proc = processChordLine(text, shift);
        outText = outText + proc.chords + "<br />";
        outText = outText + "</pre>";
        
        document.getElementById("display").innerHTML =  outText;
    }
    
    function countChords() {
        var text = getFormText();
        var lines = text.split("\n");
        var countChords = 0;
        for (var i = 0; i < lines.length; i++) {
        stats = lineAnalisys(lines[i]);
        countChords += stats['chords'];
        }
        return countChords;
    }
    
    function detectCipher() {
        setCipherSpa();
        var countChordsSpa = countChords();
        setCipherAme();
        var countChordsAme = countChords();
    
        if(countChordsAme > countChordsSpa) {
        setCipherAme();
        document.getElementById("cipher-american").checked=true;
        } else {
        setCipherSpa();
        document.getElementById("cipher-spanish").checked=true;
        }
        
    }
    
    
    function processText() {
        //document.getElementById("display").innerHTML = "Hello";
        var shift = parseInt(document.getElementById("shift-label").innerHTML);
    
        var cipher = getCipherSelection();
        if(cipher == "detect") {
        detectCipher();
        } else if(cipher == "spanish") {
        setCipherSpa();
        } else if(cipher == "american") {
        setCipherAme();
        }
    
        var text = getFormText();
        var lines = text.split("\n");
        var outText = "<pre>";
        for (var i = 0; i < lines.length; i++) {
            //proc = processLine(lines[i], shift);
            //outText = outText + proc.chords + "<br />" + proc.text + "<br />";
            isChordLine = detectChordLine(lines[i]);
            if(isChordLine) {
                proc = processChordLine(lines[i], shift);
                outText = outText + proc.chords + "<br />";
            } else {
                outText = outText + lines[i] + "<br />";
            }
            
            //outText = outText + i + ". " + lines[i] + "<br />";			
        }
        outText += "</pre>"
        document.getElementById("display").innerHTML =  outText;
    }
    
    
    function incrementShiftCh()
    {
       var text = document.getElementById("shift-label").innerHTML;
       tone = (parseInt(text) + 1) % OCTAVE; 
        document.getElementById("shift-label").innerHTML = tone;
        processText();
    }
    
    function decrementShiftCh()
    {
       var text = document.getElementById("shift-label").innerHTML;
       tone = parseInt(text) - 1; 
       if(tone < 0) tone += OCTAVE;
        document.getElementById("shift-label").innerHTML = tone;
        processText();
    }
    
    function resetShiftCh()
    {
        document.getElementById("shift-label").innerHTML = "0";
        processText();
    }
    
    function centerView(elem_id) {
        document.getElementById(elem_id).scrollIntoView(true);
    }
    
