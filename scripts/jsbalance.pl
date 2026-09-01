#!/usr/bin/perl
# Heuristic JS tokenizer that strips strings/comments/regex, then reports the
# running () depth per line so an unbalanced paren can be located.
use strict; use warnings; use utf8;
binmode(STDOUT, ":encoding(UTF-8)");
my $f = shift; open my $fh, '<:encoding(UTF-8)', $f or die $!;
local $/; my $s = <$fh>; close $fh;
my @c = split //, $s;
my $n = @c; my $i = 0; my $prev = '';        # last significant output char
my @lines; my $line = 1; my $depth = 0; my %linedepth; my @flag;
sub sig { my $ch = shift; return $ch =~ /\S/; }
while ($i < $n) {
  my $ch = $c[$i];
  if ($ch eq "\n") { $linedepth{$line} = $depth; $line++; $i++; next; }
  # comments
  if ($ch eq '/' && $i+1 < $n && $c[$i+1] eq '/') { $i += 2; while ($i < $n && $c[$i] ne "\n") { $i++; } next; }
  if ($ch eq '/' && $i+1 < $n && $c[$i+1] eq '*') { $i += 2; while ($i < $n && !($c[$i] eq '*' && $i+1<$n && $c[$i+1] eq '/')) { $line++ if $c[$i] eq "\n"; $i++; } $i += 2; next; }
  # strings
  if ($ch eq "'" || $ch eq '"' || $ch eq '`') { my $q = $ch; $i++; while ($i < $n && $c[$i] ne $q) { if ($c[$i] eq "\\") { $i += 2; next; } $line++ if $c[$i] eq "\n"; $i++; } $i++; $prev = $q; next; }
  # regex vs divide: regex if prev significant char is an operator/opener
  if ($ch eq '/') {
    if ($prev =~ /[\(\[\{,;=:\?&\|!\+\-\*%<>~\^]/ || $prev eq '') {
      $i++; my $inclass = 0;
      while ($i < $n) { my $r = $c[$i];
        if ($r eq "\\") { $i += 2; next; }
        if ($r eq '[') { $inclass = 1; }
        elsif ($r eq ']') { $inclass = 0; }
        elsif ($r eq '/' && !$inclass) { last; }
        elsif ($r eq "\n") { last; }
        $i++; }
      $i++; $prev = '/'; next;
    } else { $prev = '/'; $i++; next; }   # division
  }
  if ($ch eq '(') { $depth++; }
  elsif ($ch eq ')') { $depth--; push @flag, "line $line: depth went negative" if $depth < 0; }
  $prev = $ch if sig($ch);
  $i++;
}
$linedepth{$line} = $depth;
print "FINAL () depth: $depth  (0 = balanced)\n";
print "$_\n" for @flag;
# dump: for lines that begin a top-level function/const, show the depth at the END of the PREVIOUS line
open my $fx, '<:encoding(UTF-8)', $f or die $!; my $ln = 0;
while (my $l = <$fx>) { $ln++; next unless $l =~ /^  (function \w+|views\.\w+ = function|const \w+ =|let \w+ =)/;
  my $d = $linedepth{$ln-1} // '?'; printf "  end-depth %s before L%d: %s", $d, $ln, substr($l, 0, 66); }

# print lines where depth returns to 0 near the end + any late residual
if ($depth != 0) {
  # show depth at each function-ish boundary (lines starting with function/views.)
  open my $fh2, '<:encoding(UTF-8)', $f or die $!; my $ln = 0;
  while (my $l = <$fh2>) { $ln++; if ($l =~ /^\s*(function |views\.\w+ = function|const \w+ = )/) { printf "  depth@%d after prev block: %d  | %s", $ln, ($linedepth{$ln-1}//0), substr($l,0,60); } }
}
