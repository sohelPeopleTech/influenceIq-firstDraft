#!/usr/bin/perl
# Build web/data.js — the PulseIQ frontend data bundle, extracted from graph/data/*.tsv.
# Emits window.IIQ = { meta, suite, modules, glossary, ref, campaigns:{CP-11,CP-12,CP-13}, activeCampaign }.
# Reference/ontology data (factors, rules, KPIs, risk bands, graph reference layer) is emitted ONCE
# under `ref` and shared across campaigns; each campaign carries its own operational slice + UI config.
use strict; use warnings; use utf8;
binmode(STDOUT, ":encoding(UTF-8)");

my $DATA = $ARGV[0] // "e:/FF360/InfluenceIQ/graph/data";

# ---------- tsv helpers ----------
sub read_tab {
  my $path = shift; open my $fh, '<:encoding(UTF-8)', $path or die "open $path: $!";
  my @rows; while (<$fh>) { chomp; s/\r$//; push @rows, [ split /\t/, $_, -1 ]; }
  my $h = 0; for my $i (0..$#rows) { if (defined $rows[$i][0] && $rows[$i][0] eq '#') { $h = $i; last; } }
  my %idx; my @hdr = @{$rows[$h]}; for my $c (0..$#hdr) { $idx{$hdr[$c]} = $c; }
  return { idx => \%idx, rows => [ @rows[$h+1 .. $#rows] ], hdr => \@hdr };
}
sub camel { my $h = shift // ''; my @w = grep { length } split /[^A-Za-z0-9]+/, $h; return '' unless @w;
  my $k = lc(shift @w); $k .= ucfirst(lc($_)) for @w; $k =~ s/^(\d)/_$1/; return $k; }
sub bundle { my $path = shift; my $t = read_tab($path); my @hd = @{$t->{hdr}}; my @out;
  for my $r (@{$t->{rows}}) { my $id = defined $r->[1] ? $r->[1] : ''; $id =~ s/^\s+|\s+$//g; next if $id eq '';
    my %o = (id => $id);
    for my $c (2 .. $#hd) { my $k = camel($hd[$c]); next unless $k; my $v = defined $r->[$c] ? $r->[$c] : ''; $v =~ s/^\s+|\s+$//g; next if $v eq ''; $o{$k} = $v; }
    push @out, \%o; }
  return \@out; }
sub cell { my ($idx, $row, $name) = @_; my $c = $idx->{$name}; return '' unless defined $c; my $v = $row->[$c]; $v = '' unless defined $v; $v =~ s/^\s+|\s+$//g; return $v; }
sub splitids { my $s = shift // ''; return [ grep { length } map { s/^\s+|\s+$//gr } split /[,;]\s*/, $s ]; }
sub slurp { my $p = shift; open my $fh, '<:encoding(UTF-8)', $p or die "slurp $p: $!"; local $/; my $s = <$fh>; close $fh; return $s; }
sub raw { my $s = shift; return bless \$s, 'RAW'; }   # inject pre-formed JSON verbatim

# ---------- json ----------
sub jstr { my $s = shift; $s = '' unless defined $s; $s =~ s/\\/\\\\/g; $s =~ s/"/\\"/g; $s =~ s/\n/\\n/g; $s =~ s/\r/\\r/g; $s =~ s/\t/ /g; return '"'.$s.'"'; }
sub jenc {
  my $v = shift; my $r = ref $v;
  return ${$v} if $r eq 'RAW';
  return '['.join(',', map { jenc($_) } @$v).']' if $r eq 'ARRAY';
  if ($r eq 'HASH') { my @k = grep { $_ ne '__order' } ($v->{__order} ? @{$v->{__order}} : sort keys %$v); return '{'.join(',', map { jstr($_).':'.jenc($v->{$_}) } @k).'}'; }
  return 'null' unless defined $v;
  return $v+0 if $v =~ /^-?\d+(?:\.\d+)?$/ && $v !~ /^0\d/;
  return jstr($v);
}
sub num { my $v = shift // ''; $v =~ s/[, ]//g; $v =~ s/^Rs//i; return ($v =~ /^-?\d+(?:\.\d+)?$/) ? $v+0 : ($v eq '' ? undef : $v); }

my @factor_keys = ('Aud match','Geo match','Issue auth','Eng qual','Trust','Network','History','Format fit','Avail','Cost eff','Risk adj');
my @factor_slugs = qw(audMatch geoMatch issueAuth engQual trust network history formatFit avail costEff riskAdj);

# ================= reference (shared) layer =================
# graph reference nodes (kb registry) — also used to resolve cross-layer edges per campaign
my (%refnodes, @refnodeorder);
{ my $t = read_tab("$DATA/kb/27_node_registry.tsv");
  for my $r (@{$t->{rows}}) { my $id = cell($t->{idx},$r,'Node ID'); next unless $id; next if $refnodes{$id};
    $refnodes{$id} = { id=>$id, label=>cell($t->{idx},$r,'Label'), type=>cell($t->{idx},$r,'Node Type'), layer=>'reference' }; push @refnodeorder, $id; } }
my @refedges;
{ my $t = read_tab("$DATA/kb/28_edge_registry.tsv");
  for my $r (@{$t->{rows}}) { my $s = cell($t->{idx},$r,'Source ID'); my $tg = cell($t->{idx},$r,'Target ID'); my $rel = cell($t->{idx},$r,'Relationship');
    next unless $s && $tg && $refnodes{$s} && $refnodes{$tg}; push @refedges, { from=>$s, to=>$tg, type=>$rel }; } }
my @refgnodes = map { $refnodes{$_} } @refnodeorder;

my $factors = [ map { { key=>$factor_slugs[$_], label=>$factor_keys[$_] } } 0..$#factor_keys ];
my @issues; { my $is = read_tab("$DATA/kb/07_issues.tsv");
  for my $r (@{$is->{rows}}) { my $id = cell($is->{idx},$r,'Issue ID'); next unless $id;
    push @issues, { id=>$id, issue=>cell($is->{idx},$r,'Issue'), family=>cell($is->{idx},$r,'Family'), notes=>cell($is->{idx},$r,'Notes') }; } }
my @recs; { my $rcf = read_tab("$DATA/kb/26_recommendations.tsv");
  for my $r (@{$rcf->{rows}}) { my $id = cell($rcf->{idx},$r,'REC ID'); next unless $id;
    push @recs, { id=>$id, name=>cell($rcf->{idx},$r,'Recommendation'), type=>cell($rcf->{idx},$r,'Type'),
      trigger=>cell($rcf->{idx},$r,'Trigger Condition'), action=>cell($rcf->{idx},$r,'Recommended Action'),
      priority=>cell($rcf->{idx},$r,'Priority'), benefit=>cell($rcf->{idx},$r,'Expected Benefit'),
      addresses=>cell($rcf->{idx},$r,'Addresses (NR)'), improves=>cell($rcf->{idx},$r,'Improves (KPI)') }; } }

my $ref = {
  factors=>$factors, issues=>\@issues, recommendations=>\@recs,
  rules=>bundle("$DATA/kb/20_reasoning_rules.tsv"), kpis=>bundle("$DATA/kb/22_kpis.tsv"),
  valueDrivers=>bundle("$DATA/kb/23_value_drivers.tsv"), knowledgeChains=>bundle("$DATA/kb/17_knowledge_chains.tsv"),
  useCases=>bundle("$DATA/kb/21_use_cases.tsv"), signals=>bundle("$DATA/kb/10_signal_sources.tsv"),
  creatorTypes=>bundle("$DATA/kb/05_creator_types.tsv"), riskBands=>bundle("$DATA/kb/14_risk_confidence_bands.tsv"),
  interventions=>bundle("$DATA/kb/11_interventions.tsv"), measures=>bundle("$DATA/kb/13_measurement_concepts.tsv"),
  outcomeTypes=>bundle("$DATA/kb/09_outcome_types.tsv"), segmentTypes=>bundle("$DATA/kb/06_audience_segment_types.tsv"),
  graphRef=>{ nodes=>\@refgnodes, edges=>\@refedges },
};

# ================= per-campaign operational slice =================
sub collect { my ($path, $idname, $map) = @_; my $t = read_tab($path); my @out;
  for my $r (@{$t->{rows}}) { my $id = cell($t->{idx},$r,$idname); next unless $id;
    my %o; for my $k (keys %$map) { my $v = cell($t->{idx},$r,$map->{$k}); $o{$k} = $v; } push @out, \%o; } return \@out; }

sub build_campaign {
  my ($ops) = @_;

  # geographies
  my $g = read_tab("$ops/02_geographies.tsv"); my @geos;
  for my $r (@{$g->{rows}}) { my $id = cell($g->{idx},$r,'Geo ID'); next unless $id;
    push @geos, { id=>$id, name=>cell($g->{idx},$r,'Name'), level=>cell($g->{idx},$r,'Level'),
      parent=>cell($g->{idx},$r,'Parent'), corridor=>cell($g->{idx},$r,'Corridor'), notes=>cell($g->{idx},$r,'Notes') }; }

  # narratives
  my $nr = read_tab("$ops/01_kb_delta_narratives.tsv"); my @narr; my %narr_by;
  for my $r (@{$nr->{rows}}) { my $id = cell($nr->{idx},$r,'NR ID'); next unless $id;
    my $o = { id=>$id, name=>cell($nr->{idx},$r,'Narrative'), class=>cell($nr->{idx},$r,'Class'),
      description=>cell($nr->{idx},$r,'Description'), susceptible=>cell($nr->{idx},$r,'Susceptible Audiences'),
      drivers=>cell($nr->{idx},$r,'Driving Factors'), platforms=>cell($nr->{idx},$r,'Typical Platforms / Formats'),
      framing=>cell($nr->{idx},$r,'Framing / Morphology'), response=>cell($nr->{idx},$r,'Response / Mitigation'),
      detection=>cell($nr->{idx},$r,'Detection Signals'), aboutIssue=>cell($nr->{idx},$r,'About Issue (IS)'),
      contradicts=>cell($nr->{idx},$r,'Contradicts (NR)'), rules=>splitids(cell($nr->{idx},$r,'Rules (RR)')),
      recs=>splitids(cell($nr->{idx},$r,'Recommendations (REC)')), amplifiers=>[] };
    push @narr, $o; $narr_by{$id} = $o; }

  # creators: persons + accounts + suitability
  my $p = read_tab("$ops/03_persons_creators.tsv"); my %cr; my @crorder;
  for my $r (@{$p->{rows}}) { my $id = cell($p->{idx},$r,'Person ID'); next unless $id;
    my $amp = splitids(cell($p->{idx},$r,'Amplifies (NR)'));
    $cr{$id} = { id=>$id, name=>cell($p->{idx},$r,'Name (fictional)'), type=>cell($p->{idx},$r,'Creator Type (CT)'),
      role=>cell($p->{idx},$r,'Role / Description'), onboarded=>cell($p->{idx},$r,'Onboarded via'),
      consent=>cell($p->{idx},$r,'Consent Record'), offline=>cell($p->{idx},$r,'Offline-capable'),
      stance=>cell($p->{idx},$r,'Stance on project'), amplifies=>$amp, audienceNote=>cell($p->{idx},$r,'Audience note'),
      accounts=>[], followers=>0, suitability=>undef };
    push @crorder, $id;
    for my $n (@$amp) { push @{$narr_by{$n}{amplifiers}}, $id if $narr_by{$n}; } }
  my $ac = read_tab("$ops/05_creator_accounts.tsv");
  for my $r (@{$ac->{rows}}) { my $id = cell($ac->{idx},$r,'Account ID'); next unless $id;
    my $owner = cell($ac->{idx},$r,'Person'); next unless $cr{$owner};
    my $f = num(cell($ac->{idx},$r,'Followers (synthetic)')) // 0;
    push @{$cr{$owner}{accounts}}, { id=>$id, platform=>cell($ac->{idx},$r,'Platform'),
      handle=>cell($ac->{idx},$r,'Handle / Name'), followers=>$f, linkBasis=>cell($ac->{idx},$r,'Link basis') };
    $cr{$owner}{followers} += $f if $f; }
  my $su = read_tab("$ops/18_suitability_output.tsv");
  for my $r (@{$su->{rows}}) { my $id = cell($su->{idx},$r,'Person'); next unless $id && $cr{$id};
    my %f; for my $i (0..$#factor_keys) { $f{$factor_slugs[$i]} = num(cell($su->{idx},$r,$factor_keys[$i])); }
    $cr{$id}{suitability} = { %f, rawProduct=>num(cell($su->{idx},$r,'Raw product')),
      index=>num(cell($su->{idx},$r,'Suitability index')), confidence=>cell($su->{idx},$r,'Confidence'),
      decision=>cell($su->{idx},$r,'Decision'), note=>cell($su->{idx},$r,'Evidence note') }; }
  my @creators = map { $cr{$_} } @crorder;

  # trending
  my $tr = read_tab("$ops/10_narrative_trending.tsv"); my @trend;
  for my $r (@{$tr->{rows}}) { my $id = cell($tr->{idx},$r,'Row ID'); next unless $id;
    push @trend, { narrative=>cell($tr->{idx},$r,'Narrative'), week=>cell($tr->{idx},$r,'Week start'),
      geo=>cell($tr->{idx},$r,'Geography'), volume=>num(cell($tr->{idx},$r,'Volume (items)')),
      velocity=>num(cell($tr->{idx},$r,'Velocity (new amplifiers/day)')), sentiment=>cell($tr->{idx},$r,'Sentiment'),
      emotion=>cell($tr->{idx},$r,'Dominant emotion'), counterShare=>num(cell($tr->{idx},$r,'Counter-share')),
      stage=>cell($tr->{idx},$r,'Lifecycle stage'), topSignal=>cell($tr->{idx},$r,'Top signal') }; }

  # campaign brief (vertical)
  my $cb = read_tab("$ops/11_campaign_brief.tsv"); my %brief; my @brief_order;
  for my $r (@{$cb->{rows}}) { my $f = cell($cb->{idx},$r,'Field'); my $v = cell($cb->{idx},$r,'Value'); next unless $f;
    $brief{$f} = $v; push @brief_order, $f; }
  $brief{__order} = \@brief_order;

  my $activations = collect("$ops/12_activations.tsv", 'Activation ID',
    { id=>'Activation ID', creator=>'Creator', format=>'Format (ACT)', fee=>'Fee (Rs)', message=>'Message', weeks=>'Weeks',
      impressions=>'Impressions total', views=>'Views/Listens', clicks=>'Clicks', submissions=>'Portal submissions', registrations=>'Townhall registrations' });
  my $exposures = collect("$ops/13_exposures_weekly.tsv", 'Exposure ID',
    { id=>'Exposure ID', activation=>'Activation', week=>'Week start', impressions=>'Impressions', qualified=>'Qualified (est.)', targetShare=>'Target share', tracking=>'Tracking', scope=>'Scope' });
  my $outcomes = collect("$ops/15_outcomes.tsv", 'Outcome ID',
    { id=>'Outcome ID', outcome=>'Outcome', type=>'Type (OC)', basis=>'Basis', value=>'Value', interval=>'Interval / precision', provenance=>'Provenance', method=>'Method stamp (EC-10)', evidence=>'Evidence', oip=>'O/I/P' });
  my $attribution = collect("$ops/16_attribution.tsv", 'Attribution ID',
    { id=>'Attribution ID', outcome=>'Outcome', activation=>'Activation', credited=>'Credited value', method=>'Method stamp', oip=>'O/I/P' });
  my $surveys = collect("$ops/17_survey_waves.tsv", 'ID',
    { id=>'ID', item=>'Wave / Item', detail=>'Detail', n=>'n', frame=>'Frame / note', exposed=>'Exposed (pre -> post)', holdout=>'Holdout (pre -> post)', feeds=>'Feeds' });

  # estimates + evidence
  my $es = read_tab("$ops/08_audience_estimates.tsv"); my @estimates;
  for my $r (@{$es->{rows}}) { my $id = cell($es->{idx},$r,'Estimate ID'); next unless $id;
    push @estimates, { id=>$id, subject=>cell($es->{idx},$r,'Subject (Person)'), dimension=>cell($es->{idx},$r,'Dimension'),
      key=>cell($es->{idx},$r,'Key'), value=>num(cell($es->{idx},$r,'Value')), lo=>num(cell($es->{idx},$r,'Range lo')),
      hi=>num(cell($es->{idx},$r,'Range hi')), unit=>cell($es->{idx},$r,'Unit'), provenance=>cell($es->{idx},$r,'Provenance class'),
      confidence=>cell($es->{idx},$r,'Confidence'), evCount=>num(cell($es->{idx},$r,'Evidence count')),
      evidence=>splitids(cell($es->{idx},$r,'Evidence IDs')), window=>cell($es->{idx},$r,'Time window'),
      geoScope=>cell($es->{idx},$r,'Geo scope'), verification=>cell($es->{idx},$r,'Verification') }; }
  my $ev = read_tab("$ops/09_evidence_records.tsv"); my %evidence;
  for my $r (@{$ev->{rows}}) { my $id = cell($ev->{idx},$r,'Evidence ID'); next unless $id;
    $evidence{$id} = { id=>$id, source=>cell($ev->{idx},$r,'Source (SIG)'), sourceName=>cell($ev->{idx},$r,'Source name'),
      method=>cell($ev->{idx},$r,'Method'), collected=>cell($ev->{idx},$r,'Collected'), period=>cell($ev->{idx},$r,'Applies to period'),
      raw=>cell($ev->{idx},$r,'Raw signal (summary)'), licence=>cell($ev->{idx},$r,'Licence / basis'),
      consent=>cell($ev->{idx},$r,'Consent record'), quality=>cell($ev->{idx},$r,'Quality'), confidence=>cell($ev->{idx},$r,'Confidence'),
      verification=>cell($ev->{idx},$r,'Verification') }; }

  # operational graph slice (+ resolve edges against reference nodes too)
  my (%onodes, @oorder);
  { my $t = read_tab("$ops/19_ops_node_registry.tsv");
    for my $r (@{$t->{rows}}) { my $id = cell($t->{idx},$r,'Node ID'); next unless $id; next if $onodes{$id};
      $onodes{$id} = { id=>$id, label=>cell($t->{idx},$r,'Label'), type=>cell($t->{idx},$r,'Node Type'), layer=>'operational' }; push @oorder, $id; } }
  my @oedges;
  { my $t = read_tab("$ops/20_ops_edge_registry.tsv");
    for my $r (@{$t->{rows}}) { my $s = cell($t->{idx},$r,'Source ID'); my $tg = cell($t->{idx},$r,'Target ID'); my $rel = cell($t->{idx},$r,'Relationship');
      next unless $s && $tg; next unless ($onodes{$s} || $refnodes{$s}) && ($onodes{$tg} || $refnodes{$tg});
      push @oedges, { from=>$s, to=>$tg, type=>$rel }; } }
  my @ognodes = map { $onodes{$_} } @oorder;

  # per-campaign highlighted recommendation ids (from its narratives)
  my %rw; for my $n (@narr) { $rw{$_} = 1 for @{$n->{recs}}; }

  return {
    geographies=>\@geos, narratives=>\@narr, creators=>\@creators, trending=>\@trend,
    campaign=>\%brief, activations=>$activations, exposures=>$exposures, outcomes=>$outcomes,
    attribution=>$attribution, surveys=>$surveys, estimates=>\@estimates, evidence=>\%evidence,
    content=>bundle("$ops/06_content_items.tsv"), positions=>bundle("$ops/07_positions.tsv"),
    responses=>bundle("$ops/14_responses.tsv"),
    organisations=>(-e "$ops/04_organisations.tsv" ? bundle("$ops/04_organisations.tsv") : []),
    graphOps=>{ nodes=>\@ognodes, edges=>\@oedges },
    recHighlights=>[ sort keys %rw ],
  };
}

# ================= BrandIQ ontology delta (module-two reference rows) =================
# Bundled once under `brandRef`, alongside `ref`. The Ontology Browser shows it as a delta ON the
# shared engine — which is the whole "module two costs less than module one" argument, on screen.
my $brandRef = (-d "$DATA/brand") ? {
  outcomeTypes    => bundle("$DATA/brand/01_outcome_types.tsv"),
  signals         => bundle("$DATA/brand/02_signal_sources.tsv"),
  geoLevels       => bundle("$DATA/brand/03_geography_levels.tsv"),
  ecosystem       => bundle("$DATA/brand/04_market_ecosystem.tsv"),
  narrativeClasses=> bundle("$DATA/brand/05_narrative_classes.tsv"),
  creatorTypes    => bundle("$DATA/brand/06_creator_types.tsv"),
  issues          => bundle("$DATA/brand/07_issues.tsv"),
  interventions   => bundle("$DATA/brand/08_interventions.tsv"),
  rules           => bundle("$DATA/brand/09_reasoning_rules.tsv"),
} : {};

# ================= assemble campaigns (all modules) =================
my @CAMPS = (['CP-11',"$DATA/ops"], ['CP-12',"$DATA/ops-cp12"], ['CP-13',"$DATA/ops-cp13"],
             ['CP-B01',"$DATA/ops-brand-b01"]);
my %campaigns; my @order;
for my $c (@CAMPS) {
  my ($id, $ops) = @$c;
  next unless -d $ops;
  my $camp = build_campaign($ops);
  $camp->{config} = raw(slurp("$DATA/configs/$id.json"));
  $camp->{__order} = ['config', grep { $_ ne 'config' && $_ ne '__order' } sort keys %$camp];
  $campaigns{$id} = $camp; push @order, $id;
}
$campaigns{__order} = \@order;

my ($nn,$ee)=(scalar(@refgnodes),scalar(@refedges));
my $out = {
  meta => { generated=>scalar(gmtime()).' UTC', suite=>'InfluenceIQ', modules=>'PulseIQ + BrandIQ',
            campaigns=>scalar(@order), refNodes=>$nn, refEdges=>$ee },
  platform => raw(slurp("$DATA/configs/modules.json")),
  accounts => (-e "$DATA/configs/accounts.json" ? raw(slurp("$DATA/configs/accounts.json")) : {}),
  glossary => raw(slurp("$DATA/configs/glossary.json")),
  ref => $ref,
  brandRef => $brandRef,
  campaigns => \%campaigns,
  activeCampaign => 'CP-11',
  __order => ['meta','platform','accounts','glossary','ref','brandRef','campaigns','activeCampaign'],
};

print "// Generated by web/scripts/gen_data.pl — real multi-campaign PulseIQ data. Do not edit by hand.\n";
print "window.IIQ = ", jenc($out), ";\n";
