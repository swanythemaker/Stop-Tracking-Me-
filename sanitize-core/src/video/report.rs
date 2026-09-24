use crate::allowlist::Group;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finding {
    pub name: String,
    pub group: Group,
    pub text: String,
}

impl Finding {
    pub fn new(name: impl Into<String>, group: Group, text: impl Into<String>) -> Self {
        Finding { name: name.into(), group, text: text.into() }
    }

    pub fn line(&self) -> String {
        if self.text.is_empty() {
            self.name.clone()
        } else {
            format!("{} {}", self.name, self.text)
        }
    }
}

pub fn human_name(t: &[u8; 4]) -> String {
    t.iter()
        .map(|&c| match c {
            0xa9 => '\u{a9}',
            0x20..=0x7e => c as char,
            _ => '.',
        })
        .collect()
}

pub fn group_findings(findings: &[Finding]) -> BTreeMap<String, Vec<String>> {
    let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for f in findings {
        let line = f.line();
        let list = map.entry(f.group.label().to_string()).or_default();
        if !list.contains(&line) {
            list.push(line);
        }
    }
    map
}

pub fn push_unique(list: &mut Vec<String>, s: impl Into<String>) {
    let s = s.into();
    if !list.contains(&s) {
        list.push(s);
    }
}
